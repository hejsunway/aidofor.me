import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const STAGING_PROJECT_REF = "vokjkogzvtohdinhxhkk";
const STAGING_SUPABASE_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;
const STRIPE_ACCOUNT_ID = "acct_1Tv6yz1tdTVob40G";
const EXPECTED_AMOUNT_SEN = 2_000;
const EXPECTED_CREDITS = 2_000;

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

function one(rows, label) {
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(`${label} expected exactly one row; found ${rows?.length ?? 0}.`);
  }
  return rows[0];
}

function objectId(value) {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

const envPath = option("--env-file");
const checkoutSessionId = option("--checkout-session-id");
const outputPath = option("--output");
if (
  !envPath
  || !outputPath
  || !/^cs_test_[A-Za-z0-9]+$/.test(checkoutSessionId ?? "")
) {
  throw new Error(
    "Usage: pnpm phase2:verify-dispute-lifecycle -- --env-file /absolute/path/.env.staging.local --checkout-session-id cs_test_... --output /absolute/private/path/dispute-evidence.json",
  );
}

const resolvedOutputPath = outsideRepository(outputPath, "Dispute evidence");
const envValues = parseEnvFile(await readFile(resolve(envPath), "utf8"));
const supabaseUrl = requireValue(envValues, "NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
const billingTarget = requireValue(envValues, "AIDO_BILLING_CONFIG_TARGET");
const serviceRoleKey = requireValue(envValues, "SUPABASE_SERVICE_ROLE_KEY");
const stripeKey = requireValue(envValues, "STRIPE_SECRET_KEY");
if (supabaseUrl !== STAGING_SUPABASE_URL || billingTarget !== "staging") {
  throw new Error("The dispute verifier must target isolated AidoForMe staging exactly.");
}
if (!stripeKey.startsWith("sk_test_") && !stripeKey.startsWith("rk_test_")) {
  throw new Error("The dispute verifier requires a Stripe sandbox key.");
}

const stripe = new Stripe(stripeKey);
const [account, session] = await Promise.all([
  stripe.accounts.retrieve(),
  stripe.checkout.sessions.retrieve(checkoutSessionId, {
    expand: ["payment_intent.latest_charge", "line_items.data.price"],
  }),
]);
if (account.id !== STRIPE_ACCOUNT_ID || session.livemode) {
  throw new Error("The disputed Checkout does not belong to the approved AidoForMe sandbox.");
}
const paymentIntent = typeof session.payment_intent === "string" ? null : session.payment_intent;
const chargeId = objectId(paymentIntent?.latest_charge ?? null);
const lineItems = session.line_items?.data ?? [];
if (
  session.mode !== "payment"
  || session.status !== "complete"
  || session.payment_status !== "paid"
  || session.currency !== "myr"
  || session.amount_total !== EXPECTED_AMOUNT_SEN
  || !chargeId
  || lineItems.length !== 1
  || lineItems[0].quantity !== 1
) throw new Error("The disputed Checkout facts do not match the reviewed RM20 product.");
const charge = await stripe.charges.retrieve(chargeId);
if (!charge.paid || !charge.disputed || charge.livemode) {
  throw new Error("The sandbox charge is not marked disputed.");
}
const disputes = await stripe.disputes.list({ charge: chargeId, limit: 100 });
const dispute = one(disputes.data, "Stripe dispute");
if (dispute.livemode || dispute.amount !== EXPECTED_AMOUNT_SEN || dispute.currency !== "myr") {
  throw new Error("The Stripe dispute does not match the full RM20 charge.");
}

const createdGte = Math.max(0, session.created - 120);
const [checkoutEvents, disputeEvents] = await Promise.all([
  stripe.events.list({ type: "checkout.session.completed", created: { gte: createdGte }, limit: 100 }),
  stripe.events.list({ type: "charge.dispute.created", created: { gte: createdGte }, limit: 100 }),
]);
const checkoutEvent = one(
  checkoutEvents.data.filter((event) => event.data.object?.id === session.id),
  "disputed Checkout event",
);
const disputeEvent = one(
  disputeEvents.data.filter((event) => event.data.object?.id === dispute.id),
  "dispute event",
);
if (checkoutEvent.livemode || disputeEvent.livemode) {
  throw new Error("A dispute lifecycle event unexpectedly belongs to live mode.");
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const [purchaseResult, disputePaymentResult] = await Promise.all([
  admin
    .from("aido_payment_events")
    .select("id,user_id,event_kind,stripe_event_id,stripe_object_id,status,credits_affected,amount_gross_sen")
    .eq("stripe_event_id", checkoutEvent.id),
  admin
    .from("aido_payment_events")
    .select("id,user_id,event_kind,stripe_event_id,stripe_object_id,related_payment_event_id,status,credits_affected,amount_gross_sen")
    .eq("stripe_event_id", disputeEvent.id),
]);
if (purchaseResult.error) throw purchaseResult.error;
if (disputePaymentResult.error) throw disputePaymentResult.error;
const purchase = one(purchaseResult.data, "disputed purchase payment");
const disputePayment = one(disputePaymentResult.data, "dispute payment");
const [lotResult, reversalResult, walletResult] = await Promise.all([
  admin
    .from("aido_credit_lots")
    .select("id,granted_credits,remaining_credits,reserved_credits,status")
    .eq("payment_event_id", purchase.id),
  admin
    .from("aido_credit_reversals")
    .select("id,credit_lot_id,payment_event_id,ledger_entry_id,reversal_type,requested_credits,recovered_credits,unrecovered_credits")
    .eq("payment_event_id", disputePayment.id),
  admin
    .from("aido_credit_wallets")
    .select("available_credits,reserved_credits,unrecovered_credits,status")
    .eq("user_id", purchase.user_id)
    .single(),
]);
if (lotResult.error) throw lotResult.error;
if (reversalResult.error) throw reversalResult.error;
if (walletResult.error) throw walletResult.error;
const lot = one(lotResult.data, "disputed purchase lot");
const reversal = one(reversalResult.data, "dispute reversal");
const wallet = walletResult.data;
const ledgerResult = await admin
  .from("aido_credit_ledger")
  .select("id,entry_type,available_delta,unrecovered_delta,available_balance_after,reserved_balance_after,unrecovered_balance_after")
  .eq("id", reversal.ledger_entry_id);
if (ledgerResult.error) throw ledgerResult.error;
const ledger = one(ledgerResult.data, "dispute ledger");
if (
  purchase.event_kind !== "purchase"
  || purchase.stripe_object_id !== chargeId
  || purchase.status !== "processed"
  || purchase.credits_affected !== EXPECTED_CREDITS
  || purchase.amount_gross_sen !== EXPECTED_AMOUNT_SEN
  || disputePayment.event_kind !== "dispute"
  || disputePayment.related_payment_event_id !== purchase.id
  || disputePayment.stripe_object_id !== dispute.id
  || disputePayment.status !== "processed"
  || disputePayment.credits_affected !== EXPECTED_CREDITS
  || reversal.reversal_type !== "chargeback"
  || reversal.credit_lot_id !== lot.id
  || reversal.requested_credits !== EXPECTED_CREDITS
  || reversal.recovered_credits !== EXPECTED_CREDITS
  || reversal.unrecovered_credits !== 0
  || lot.granted_credits !== EXPECTED_CREDITS
  || lot.remaining_credits !== 0
  || lot.reserved_credits !== 0
  || lot.status !== "reversed"
  || ledger.entry_type !== "reversal"
  || ledger.available_delta !== -EXPECTED_CREDITS
  || ledger.unrecovered_delta !== 0
  || wallet.status !== "frozen"
  || wallet.unrecovered_credits <= 0
  || wallet.available_credits < 0
  || wallet.reserved_credits < 0
) throw new Error("The dispute purchase, reversal, lot, ledger, or frozen wallet did not reconcile.");

const disputePrecededCheckout = disputeEvent.created < checkoutEvent.created;
const evidence = {
  verified_at: new Date().toISOString(),
  target_environment: "staging",
  staging_project_ref: STAGING_PROJECT_REF,
  stripe_account_id: account.id,
  stripe_mode: "test",
  checkout_session_id: session.id,
  charge_id: chargeId,
  dispute_id: dispute.id,
  checkout_event_id: checkoutEvent.id,
  dispute_event_id: disputeEvent.id,
  event_order: {
    checkout_event_created_at: new Date(checkoutEvent.created * 1000).toISOString(),
    dispute_event_created_at: new Date(disputeEvent.created * 1000).toISOString(),
    dispute_preceded_checkout: disputePrecededCheckout,
    recovery: disputePrecededCheckout
      ? "Signed Checkout event was redelivered before signed dispute-event retry."
      : "Normal event order; no source-before-reversal recovery required.",
  },
  persistence: {
    purchase_credit_effect: EXPECTED_CREDITS,
    dispute_credit_effect: -EXPECTED_CREDITS,
    net_credit_effect: 0,
    reversal_requested_credits: reversal.requested_credits,
    reversal_recovered_credits: reversal.recovered_credits,
    reversal_unrecovered_credits: reversal.unrecovered_credits,
    wallet,
    balances_nonnegative: true,
  },
  account_id_sha256: createHash("sha256").update(purchase.user_id).digest("hex"),
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
  checkout_event_id: checkoutEvent.id,
  dispute_event_id: disputeEvent.id,
  dispute_preceded_checkout: disputePrecededCheckout,
  net_credit_effect: 0,
  wallet_status: wallet.status,
  wallet_available_credits: wallet.available_credits,
  wallet_unrecovered_credits: wallet.unrecovered_credits,
  output_path: resolvedOutputPath,
}, null, 2));
