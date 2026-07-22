import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const STAGING_PROJECT_REF = "vokjkogzvtohdinhxhkk";
const STAGING_SUPABASE_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;
const STRIPE_ACCOUNT_ID = "acct_1Tv6yz1tdTVob40G";
const DECLINING_PAYMENT_METHOD = "pm_card_chargeCustomerFail";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseEnvFile(source) {
  const values = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'")))
    ) value = value.slice(1, -1);
    values[name] = value;
  }
  return values;
}

function requireValue(values, name) {
  const value = values[name] || process.env[name];
  if (!value) throw new Error(`${name} is missing.`);
  return value;
}

function outsideRepository(path, label) {
  const repositoryRoot = resolve(".");
  const resolvedPath = resolve(path);
  if (
    resolvedPath === repositoryRoot
    || resolvedPath.startsWith(`${repositoryRoot}${sep}`)
  ) throw new Error(`${label} must be outside the repository.`);
  return resolvedPath;
}

function objectId(value) {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

async function waitForDatabaseFailure(admin, subscriptionId, eventId) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const [projectionResult, journalResult, paymentResult] = await Promise.all([
      admin
        .from("aido_subscriptions")
        .select("user_id,status,last_payment_failed_at,last_stripe_event_id,last_stripe_event_type,current_period_start,current_period_end,cancel_at_period_end")
        .eq("stripe_subscription_id", subscriptionId)
        .single(),
      admin
        .from("aido_subscription_events")
        .select("stripe_event_id,stripe_event_type,subscription_status,projection_applied,event_created_at")
        .eq("stripe_event_id", eventId),
      admin
        .from("aido_payment_events")
        .select("id")
        .eq("stripe_event_id", eventId),
    ]);
    if (projectionResult.error) throw projectionResult.error;
    if (journalResult.error) throw journalResult.error;
    if (paymentResult.error) throw paymentResult.error;
    if (journalResult.data.length === 1 && projectionResult.data.last_payment_failed_at) {
      return {
        projection: projectionResult.data,
        journal: journalResult.data[0],
        paymentRows: paymentResult.data,
      };
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }
  throw new Error("The signed invoice.payment_failed webhook was not persisted in staging.");
}

const envPath = option("--env-file");
const subscriptionId = option("--subscription-id");
const outputPath = option("--output");
const execute = process.argv.includes("--execute");
if (
  !envPath
  || !outputPath
  || !subscriptionId
  || !/^sub_[A-Za-z0-9]+$/.test(subscriptionId)
  || !execute
) {
  throw new Error(
    "Usage: pnpm phase2:exercise-failed-renewal -- --env-file /absolute/path/.env.staging.local --subscription-id sub_... --output /absolute/private/path/failed-renewal-evidence.json --execute",
  );
}

const resolvedOutputPath = outsideRepository(outputPath, "Failed-renewal evidence");
const envValues = parseEnvFile(await readFile(resolve(envPath), "utf8"));
const supabaseUrl = requireValue(envValues, "NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
const billingTarget = requireValue(envValues, "AIDO_BILLING_CONFIG_TARGET");
const serviceRoleKey = requireValue(envValues, "SUPABASE_SERVICE_ROLE_KEY");
const stripeKey = requireValue(envValues, "STRIPE_SECRET_KEY");
if (supabaseUrl !== STAGING_SUPABASE_URL || billingTarget !== "staging") {
  throw new Error("The failed-renewal exercise must target isolated AidoForMe staging exactly.");
}
if (!stripeKey.startsWith("sk_test_") && !stripeKey.startsWith("rk_test_")) {
  throw new Error("The failed-renewal exercise requires a Stripe sandbox key.");
}

const stripe = new Stripe(stripeKey);
const [account, subscriptionBefore] = await Promise.all([
  stripe.accounts.retrieve(),
  stripe.subscriptions.retrieve(subscriptionId, { expand: ["latest_invoice"] }),
]);
if (account.id !== STRIPE_ACCOUNT_ID || subscriptionBefore.livemode) {
  throw new Error("The subscription does not belong to the approved AidoForMe sandbox.");
}
const customerId = objectId(subscriptionBefore.customer);
if (!customerId) throw new Error("The subscription is missing its customer.");
const subscriptionInvoices = await stripe.invoices.list({
  customer: customerId,
  subscription: subscriptionId,
  limit: 100,
});
const initialInvoice = subscriptionInvoices.data.find((invoice) => (
  invoice.billing_reason === "subscription_create" && invoice.status === "paid"
));
const existingFailedInvoice = subscriptionInvoices.data.find((invoice) => (
  invoice.metadata?.aido_phase2_evidence === "failed_renewal"
  && invoice.status === "open"
  && invoice.amount_paid === 0
));
const initialInvoiceId = initialInvoice?.id ?? null;
const alreadyFailed = subscriptionBefore.status === "past_due" && Boolean(existingFailedInvoice);
if (!initialInvoiceId) throw new Error("The verified initial paid invoice is missing.");
if (
  (!alreadyFailed && subscriptionBefore.status !== "active")
  || subscriptionBefore.cancel_at_period_end
) throw new Error("The failed-renewal exercise requires the verified active or already-failed subscription.");

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const projectionBeforeResult = await admin
  .from("aido_subscriptions")
  .select("user_id,status,latest_invoice_id,last_payment_failed_at")
  .eq("stripe_subscription_id", subscriptionId)
  .single();
if (projectionBeforeResult.error) throw projectionBeforeResult.error;
if (alreadyFailed) {
  if (
    projectionBeforeResult.data.status !== "past_due"
    || projectionBeforeResult.data.latest_invoice_id !== existingFailedInvoice.id
    || !projectionBeforeResult.data.last_payment_failed_at
  ) throw new Error("The existing failed-renewal projection is incomplete.");
} else if (
  projectionBeforeResult.data.status !== "active"
  || projectionBeforeResult.data.latest_invoice_id !== initialInvoiceId
  || projectionBeforeResult.data.last_payment_failed_at !== null
) throw new Error("The staging subscription projection is not at the verified initial baseline.");
const walletBeforeResult = await admin
  .from("aido_credit_wallets")
  .select("available_credits,reserved_credits,unrecovered_credits,status")
  .eq("user_id", projectionBeforeResult.data.user_id)
  .single();
if (walletBeforeResult.error) throw walletBeforeResult.error;

let failedInvoiceId = existingFailedInvoice?.id ?? null;
if (!alreadyFailed) {
  const attachedPaymentMethods = await stripe.paymentMethods.list({
    customer: customerId,
    type: "card",
    limit: 100,
  });
  let decliningPaymentMethod = attachedPaymentMethods.data.find((paymentMethod) => (
    paymentMethod.card?.last4 === "0341"
  ));
  if (!decliningPaymentMethod) {
    decliningPaymentMethod = await stripe.paymentMethods.attach(
      DECLINING_PAYMENT_METHOD,
      { customer: customerId },
    );
  }
  await stripe.subscriptions.update(
    subscriptionId,
    { default_payment_method: decliningPaymentMethod.id },
    { idempotencyKey: `aido-phase2-failing-payment-method-v2-${subscriptionId}` },
  );
  const subscriptionAfter = await stripe.subscriptions.update(
    subscriptionId,
    {
      billing_cycle_anchor: "now",
      proration_behavior: "none",
      payment_behavior: "allow_incomplete",
    },
    { idempotencyKey: `aido-phase2-failed-renewal-${subscriptionId}` },
  );
  failedInvoiceId = objectId(subscriptionAfter.latest_invoice);
  if (!failedInvoiceId || failedInvoiceId === initialInvoiceId) {
    const subscriptionItem = subscriptionBefore.items.data.length === 1
      ? subscriptionBefore.items.data[0]
      : null;
    const subscriptionPriceId = objectId(subscriptionItem?.price ?? null);
    if (!subscriptionPriceId || subscriptionItem?.quantity !== 1) {
      throw new Error("The reviewed subscription price could not be resolved for the renewal invoice.");
    }
    await stripe.invoiceItems.create(
      {
        customer: customerId,
        subscription: subscriptionId,
        amount: 2_900,
        currency: "myr",
        description: "AidoFor.me Student Monthly controlled failed-renewal evidence",
        metadata: { aido_phase2_evidence: "failed_renewal" },
      },
      { idempotencyKey: `aido-phase2-failed-renewal-item-v2-${subscriptionId}` },
    );
    const draftInvoice = await stripe.invoices.create(
      {
        customer: customerId,
        subscription: subscriptionId,
        collection_method: "charge_automatically",
        auto_advance: false,
        default_payment_method: decliningPaymentMethod.id,
        metadata: { aido_phase2_evidence: "failed_renewal" },
      },
      { idempotencyKey: `aido-phase2-failed-renewal-invoice-v2-${subscriptionId}` },
    );
    await stripe.invoices.finalizeInvoice(
      draftInvoice.id,
      { auto_advance: false },
      { idempotencyKey: `aido-phase2-failed-renewal-finalize-${subscriptionId}` },
    );
    try {
      await stripe.invoices.pay(
        draftInvoice.id,
        { payment_method: decliningPaymentMethod.id },
        { idempotencyKey: `aido-phase2-failed-renewal-pay-${subscriptionId}` },
      );
      throw new Error("The controlled renewal payment unexpectedly succeeded.");
    } catch (error) {
      if (
        typeof error !== "object"
        || error === null
        || !("code" in error)
        || error.code !== "card_declined"
      ) throw error;
    }
    failedInvoiceId = draftInvoice.id;
  }
}
if (!failedInvoiceId) throw new Error("Stripe did not create a distinct failed renewal invoice.");
const failedInvoice = await stripe.invoices.retrieve(failedInvoiceId);
if (
  failedInvoice.livemode
  || failedInvoice.status !== "open"
  || failedInvoice.amount_due !== 2_900
  || failedInvoice.amount_paid !== 0
  || failedInvoice.currency !== "myr"
) throw new Error("The renewal invoice did not fail with the reviewed RM29 billing facts.");

const failedEvents = await stripe.events.list({
  type: "invoice.payment_failed",
  created: { gte: subscriptionBefore.created },
  limit: 100,
});
const failedEvent = failedEvents.data.find((event) => event.data.object?.id === failedInvoice.id);
if (!failedEvent || failedEvent.livemode) throw new Error("Stripe did not emit the expected sandbox invoice.payment_failed event.");

const persisted = await waitForDatabaseFailure(admin, subscriptionId, failedEvent.id);
const subscriptionCurrent = await stripe.subscriptions.retrieve(subscriptionId);
const walletAfterResult = await admin
  .from("aido_credit_wallets")
  .select("available_credits,reserved_credits,unrecovered_credits,status")
  .eq("user_id", projectionBeforeResult.data.user_id)
  .single();
if (walletAfterResult.error) throw walletAfterResult.error;
const walletBefore = walletBeforeResult.data;
const walletAfter = walletAfterResult.data;
if (
  persisted.journal.stripe_event_type !== "invoice.payment_failed"
  || !persisted.journal.projection_applied
  || persisted.projection.last_stripe_event_id !== failedEvent.id
  || persisted.projection.last_stripe_event_type !== "invoice.payment_failed"
  || persisted.projection.status !== subscriptionCurrent.status
  || persisted.paymentRows.length !== 0
  || JSON.stringify(walletAfter) !== JSON.stringify(walletBefore)
  || walletAfter.available_credits < 0
  || walletAfter.reserved_credits < 0
  || walletAfter.unrecovered_credits < 0
) throw new Error("The failed renewal projection or zero-grant wallet evidence did not reconcile.");

const evidence = {
  verified_at: new Date().toISOString(),
  target_environment: "staging",
  staging_project_ref: STAGING_PROJECT_REF,
  stripe_account_id: account.id,
  stripe_mode: "test",
  subscription_id: subscriptionId,
  initial_invoice_id: initialInvoiceId,
  failed_invoice_id: failedInvoice.id,
  failed_event_id: failedEvent.id,
  failed_invoice: {
    status: failedInvoice.status,
    amount_due_sen: failedInvoice.amount_due,
    amount_paid_sen: failedInvoice.amount_paid,
    currency: failedInvoice.currency,
  },
  persistence: {
    subscription_status: persisted.projection.status,
    last_payment_failed_at: persisted.projection.last_payment_failed_at,
    journal_event_type: persisted.journal.stripe_event_type,
    financial_effect_count: persisted.paymentRows.length,
    wallet_before: walletBefore,
    wallet_after: walletAfter,
    wallet_unchanged: true,
    balances_nonnegative: true,
  },
  account_id_sha256: createHash("sha256").update(projectionBeforeResult.data.user_id).digest("hex"),
};
await mkdir(dirname(resolvedOutputPath), { recursive: true, mode: 0o700 });
await writeFile(resolvedOutputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
await chmod(resolvedOutputPath, 0o600);
console.log(JSON.stringify({
  passed: true,
  subscription_id: subscriptionId,
  failed_invoice_id: failedInvoice.id,
  failed_event_id: failedEvent.id,
  subscription_status: persisted.projection.status,
  financial_effect_count: persisted.paymentRows.length,
  wallet_available_credits: walletAfter.available_credits,
  output_path: resolvedOutputPath,
}, null, 2));
