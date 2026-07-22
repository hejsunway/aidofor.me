import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const STAGING_PROJECT_REF = "vokjkogzvtohdinhxhkk";
const STAGING_SUPABASE_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;
const STRIPE_ACCOUNT_ID = "acct_1Tv6yz1tdTVob40G";
const EXPECTED_AMOUNT_SEN = 2_900;
const EXPECTED_CREDIT_GRANT = 2_900;
const EXPECTED_EXPIRY_DAYS = 35;

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

function one(rows, label) {
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(`${label} expected exactly one row; found ${rows?.length ?? 0}.`);
  }
  return rows[0];
}

async function matchingStripeEvent(stripe, type, objectIdValue, createdGte) {
  const events = await stripe.events.list({
    type,
    created: { gte: createdGte },
    limit: 100,
  });
  return one(events.data.filter((event) => event.data.object?.id === objectIdValue), `${type} event`);
}

const envPath = option("--env-file");
const checkoutSessionId = option("--checkout-session-id");
const outputPath = option("--output");
if (
  !envPath
  || !outputPath
  || !checkoutSessionId
  || !/^cs_test_[A-Za-z0-9]+$/.test(checkoutSessionId)
) {
  throw new Error(
    "Usage: pnpm phase2:verify-subscription-lifecycle -- --env-file /absolute/path/.env.staging.local --checkout-session-id cs_test_... --output /absolute/private/path/subscription-evidence.json",
  );
}

const resolvedOutputPath = outsideRepository(outputPath, "Subscription evidence");
const envValues = parseEnvFile(await readFile(resolve(envPath), "utf8"));
const supabaseUrl = requireValue(envValues, "NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
const billingTarget = requireValue(envValues, "AIDO_BILLING_CONFIG_TARGET");
const serviceRoleKey = requireValue(envValues, "SUPABASE_SERVICE_ROLE_KEY");
const stripeKey = requireValue(envValues, "STRIPE_SECRET_KEY");
if (supabaseUrl !== STAGING_SUPABASE_URL || billingTarget !== "staging") {
  throw new Error("The subscription verifier must target isolated AidoForMe staging exactly.");
}
if (!stripeKey.startsWith("sk_test_") && !stripeKey.startsWith("rk_test_")) {
  throw new Error("The subscription verifier requires a Stripe sandbox key.");
}

const stripe = new Stripe(stripeKey);
const [account, session] = await Promise.all([
  stripe.accounts.retrieve(),
  stripe.checkout.sessions.retrieve(checkoutSessionId, {
    expand: ["line_items.data.price", "subscription"],
  }),
]);
if (account.id !== STRIPE_ACCOUNT_ID || session.livemode) {
  throw new Error("The subscription Checkout does not belong to the approved AidoForMe sandbox.");
}
const subscriptionId = objectId(session.subscription);
const customerId = objectId(session.customer);
const lineItems = session.line_items?.data ?? [];
const priceId = lineItems.length === 1 ? objectId(lineItems[0].price) : null;
if (
  session.mode !== "subscription"
  || session.status !== "complete"
  || session.payment_status !== "paid"
  || session.currency !== "myr"
  || session.amount_total !== EXPECTED_AMOUNT_SEN
  || !subscriptionId
  || !customerId
  || !priceId
  || lineItems.length !== 1
  || lineItems[0].quantity !== 1
) throw new Error("The Stripe subscription Checkout facts do not match the reviewed RM29 product.");

const subscription = typeof session.subscription === "string"
  ? await stripe.subscriptions.retrieve(session.subscription, { expand: ["latest_invoice"] })
  : session.subscription;
const latestInvoiceId = objectId(subscription.latest_invoice);
if (!latestInvoiceId || subscription.status !== "active" || subscription.cancel_at_period_end) {
  throw new Error("The Stripe subscription is not active after its settled initial invoice.");
}
const invoice = typeof subscription.latest_invoice === "string"
  ? await stripe.invoices.retrieve(subscription.latest_invoice)
  : subscription.latest_invoice;
if (
  invoice.id !== latestInvoiceId
  || invoice.status !== "paid"
  || invoice.amount_paid !== EXPECTED_AMOUNT_SEN
  || invoice.currency !== "myr"
) throw new Error("The subscription's initial invoice is not the reviewed paid RM29 invoice.");

const createdGte = Math.max(0, session.created - 120);
const [checkoutEvent, invoicePaidEvent, subscriptionCreatedEvent] = await Promise.all([
  matchingStripeEvent(stripe, "checkout.session.completed", session.id, createdGte),
  matchingStripeEvent(stripe, "invoice.paid", invoice.id, createdGte),
  matchingStripeEvent(stripe, "customer.subscription.created", subscription.id, createdGte),
]);
if (checkoutEvent.livemode || invoicePaidEvent.livemode || subscriptionCreatedEvent.livemode) {
  throw new Error("A subscription lifecycle event unexpectedly belongs to live mode.");
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const [projectionResult, journalResult, paymentResult, nonInvoicePaymentResult, walletResult] = await Promise.all([
  admin
    .from("aido_subscriptions")
    .select("id,user_id,credit_product_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,status,cancel_at_period_end,current_period_start,current_period_end,latest_invoice_id,last_payment_failed_at,livemode,last_stripe_event_id,last_stripe_event_type")
    .eq("stripe_subscription_id", subscription.id),
  admin
    .from("aido_subscription_events")
    .select("stripe_event_id,stripe_event_type,subscription_status,projection_applied,event_created_at")
    .eq("stripe_subscription_id", subscription.id),
  admin
    .from("aido_payment_events")
    .select("id,stripe_event_id,stripe_event_type,event_kind,stripe_object_id,user_id,credit_product_id,currency,amount_gross_sen,amount_net_sen,credits_affected,status,processed_at")
    .eq("stripe_event_id", invoicePaidEvent.id),
  admin
    .from("aido_payment_events")
    .select("stripe_event_id")
    .in("stripe_event_id", [checkoutEvent.id, subscriptionCreatedEvent.id]),
  admin
    .from("aido_credit_wallets")
    .select("user_id,available_credits,reserved_credits,unrecovered_credits,status")
    .eq("user_id", session.metadata?.aido_user_id ?? "00000000-0000-0000-0000-000000000000"),
]);
for (const result of [projectionResult, journalResult, paymentResult, nonInvoicePaymentResult, walletResult]) {
  if (result.error) throw result.error;
}
const projection = one(projectionResult.data, "subscription projection");
if (paymentResult.data.length !== 1) {
  throw new Error(
    `invoice.paid event ${invoicePaidEvent.id} expected exactly one financial row; found ${paymentResult.data.length}.`,
  );
}
const payment = paymentResult.data[0];
if (nonInvoicePaymentResult.data.length !== 0) {
  throw new Error("Credits were incorrectly granted from Checkout/subscription creation instead of invoice.paid.");
}
const walletQuery = walletResult.data.length
  ? walletResult
  : await admin
    .from("aido_credit_wallets")
    .select("user_id,available_credits,reserved_credits,unrecovered_credits,status")
    .eq("user_id", projection.user_id);
if (walletQuery.error) throw walletQuery.error;
const wallet = one(walletQuery.data, "subscription wallet");

const [lotResult, ledgerResult] = await Promise.all([
  admin
    .from("aido_credit_lots")
    .select("id,user_id,source,credit_product_id,payment_event_id,granted_credits,remaining_credits,reserved_credits,status,expires_at,created_at")
    .eq("payment_event_id", payment.id),
  admin
    .from("aido_credit_ledger")
    .select("id,entry_type,available_delta,reserved_delta,available_balance_after,reserved_balance_after,unrecovered_balance_after")
    .eq("payment_event_id", payment.id),
]);
if (lotResult.error) throw lotResult.error;
if (ledgerResult.error) throw ledgerResult.error;
const lot = one(lotResult.data, "subscription credit lot");
const ledger = one(ledgerResult.data, "subscription grant ledger");
const expiryDays = (new Date(lot.expires_at).valueOf() - new Date(lot.created_at).valueOf()) / 86_400_000;
const journalTypes = new Set(journalResult.data.map((event) => event.stripe_event_type));
if (
  projection.user_id !== payment.user_id
  || projection.credit_product_id !== payment.credit_product_id
  || projection.stripe_customer_id !== customerId
  || projection.stripe_price_id !== priceId
  || projection.status !== "active"
  || projection.cancel_at_period_end
  || projection.latest_invoice_id !== invoice.id
  || projection.last_payment_failed_at !== null
  || projection.livemode
  || !journalTypes.has("checkout.session.completed")
  || !journalTypes.has("invoice.paid")
  || !journalTypes.has("customer.subscription.created")
  || payment.stripe_event_type !== "invoice.paid"
  || payment.event_kind !== "renewal"
  || payment.currency !== "MYR"
  || payment.amount_gross_sen !== EXPECTED_AMOUNT_SEN
  || payment.amount_net_sen <= 0
  || payment.amount_net_sen > EXPECTED_AMOUNT_SEN
  || payment.credits_affected !== EXPECTED_CREDIT_GRANT
  || payment.status !== "processed"
  || !payment.processed_at
  || lot.user_id !== payment.user_id
  || lot.credit_product_id !== payment.credit_product_id
  || lot.source !== "subscription"
  || lot.granted_credits !== EXPECTED_CREDIT_GRANT
  || lot.remaining_credits !== EXPECTED_CREDIT_GRANT
  || lot.reserved_credits !== 0
  || lot.status !== "active"
  || Math.abs(expiryDays - EXPECTED_EXPIRY_DAYS) > 0.01
  || ledger.entry_type !== "grant"
  || ledger.available_delta !== EXPECTED_CREDIT_GRANT
  || ledger.reserved_delta !== 0
  || wallet.available_credits < EXPECTED_CREDIT_GRANT
  || wallet.reserved_credits < 0
  || wallet.unrecovered_credits < 0
  || ledger.available_balance_after < 0
  || ledger.reserved_balance_after < 0
  || ledger.unrecovered_balance_after < 0
) throw new Error("The subscription projection, invoice-only grant, lot, ledger, or wallet did not reconcile.");

const evidence = {
  verified_at: new Date().toISOString(),
  target_environment: "staging",
  staging_project_ref: STAGING_PROJECT_REF,
  stripe_account_id: account.id,
  stripe_mode: "test",
  checkout: {
    session_id: session.id,
    event_id: checkoutEvent.id,
    amount_sen: session.amount_total,
    payment_status: session.payment_status,
  },
  subscription: {
    id: subscription.id,
    created_event_id: subscriptionCreatedEvent.id,
    status: subscription.status,
    cancel_at_period_end: subscription.cancel_at_period_end,
    latest_invoice_id: invoice.id,
  },
  invoice: {
    id: invoice.id,
    paid_event_id: invoicePaidEvent.id,
    amount_paid_sen: invoice.amount_paid,
    status: invoice.status,
  },
  persistence: {
    projection_status: projection.status,
    journal_event_types: [...journalTypes].sort(),
    financial_effect_event_id: payment.stripe_event_id,
    financial_effect_event_type: payment.stripe_event_type,
    checkout_or_created_financial_effect_count: nonInvoicePaymentResult.data.length,
    credit_lot_count: lotResult.data.length,
    ledger_grant_count: ledgerResult.data.length,
    granted_credits: lot.granted_credits,
    expires_after_days: expiryDays,
    wallet_available_credits: wallet.available_credits,
    wallet_reserved_credits: wallet.reserved_credits,
    wallet_unrecovered_credits: wallet.unrecovered_credits,
    balances_nonnegative: true,
  },
  account_id_sha256: createHash("sha256").update(projection.user_id).digest("hex"),
};
await mkdir(dirname(resolvedOutputPath), { recursive: true, mode: 0o700 });
await writeFile(resolvedOutputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
await chmod(resolvedOutputPath, 0o600);
console.log(JSON.stringify({
  passed: true,
  checkout_session_id: session.id,
  subscription_id: subscription.id,
  invoice_id: invoice.id,
  invoice_paid_event_id: invoicePaidEvent.id,
  grant_event_type: payment.stripe_event_type,
  checkout_or_created_financial_effect_count: nonInvoicePaymentResult.data.length,
  granted_credits: lot.granted_credits,
  wallet_available_credits: wallet.available_credits,
  output_path: resolvedOutputPath,
}, null, 2));
