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

const envPath = option("--env-file");
const chargeId = option("--charge-id");
const outputPath = option("--output");
const execute = process.argv.includes("--execute");
if (!envPath || !outputPath || !/^ch_[A-Za-z0-9]+$/.test(chargeId ?? "") || !execute) {
  throw new Error(
    "Usage: pnpm phase2:exercise-refund -- --env-file /absolute/path/.env.staging.local --charge-id ch_... --output /absolute/private/path/refund-evidence.json --execute",
  );
}

const resolvedOutputPath = outsideRepository(outputPath, "Refund evidence");
const envValues = parseEnvFile(await readFile(resolve(envPath), "utf8"));
const supabaseUrl = requireValue(envValues, "NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
const billingTarget = requireValue(envValues, "AIDO_BILLING_CONFIG_TARGET");
const serviceRoleKey = requireValue(envValues, "SUPABASE_SERVICE_ROLE_KEY");
const stripeKey = requireValue(envValues, "STRIPE_SECRET_KEY");
if (supabaseUrl !== STAGING_SUPABASE_URL || billingTarget !== "staging") {
  throw new Error("The refund exercise must target isolated AidoForMe staging exactly.");
}
if (!stripeKey.startsWith("sk_test_") && !stripeKey.startsWith("rk_test_")) {
  throw new Error("The refund exercise requires a Stripe sandbox key.");
}

const stripe = new Stripe(stripeKey);
const [account, charge] = await Promise.all([
  stripe.accounts.retrieve(),
  stripe.charges.retrieve(chargeId),
]);
if (account.id !== STRIPE_ACCOUNT_ID || charge.livemode) {
  throw new Error("The charge does not belong to the approved AidoForMe sandbox.");
}
if (!charge.paid || charge.amount !== EXPECTED_AMOUNT_SEN || charge.currency !== "myr") {
  throw new Error("The refund target is not the verified paid RM20 top-up charge.");
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const originalPaymentResult = await admin
  .from("aido_payment_events")
  .select("id,user_id,event_kind,status,credits_affected,amount_gross_sen")
  .eq("stripe_object_id", chargeId)
  .eq("event_kind", "purchase");
if (originalPaymentResult.error) throw originalPaymentResult.error;
const originalPayment = one(originalPaymentResult.data, "original top-up payment");
if (
  originalPayment.status !== "processed"
  || originalPayment.credits_affected !== EXPECTED_CREDITS
  || originalPayment.amount_gross_sen !== EXPECTED_AMOUNT_SEN
) throw new Error("The original top-up payment is not the verified 2,000-credit grant.");

const [lotBeforeResult, walletBeforeResult] = await Promise.all([
  admin
    .from("aido_credit_lots")
    .select("id,granted_credits,remaining_credits,reserved_credits,status")
    .eq("payment_event_id", originalPayment.id),
  admin
    .from("aido_credit_wallets")
    .select("available_credits,reserved_credits,unrecovered_credits,status")
    .eq("user_id", originalPayment.user_id)
    .single(),
]);
if (lotBeforeResult.error) throw lotBeforeResult.error;
if (walletBeforeResult.error) throw walletBeforeResult.error;
const lotBefore = one(lotBeforeResult.data, "original top-up lot");
const walletBefore = walletBeforeResult.data;
if (lotBefore.granted_credits !== EXPECTED_CREDITS || lotBefore.reserved_credits !== 0) {
  throw new Error("The original top-up lot does not match the reviewed grant.");
}

const existingRefunds = await stripe.refunds.list({ charge: chargeId, limit: 100 });
let refund = existingRefunds.data.find((item) => item.metadata?.aido_phase2_evidence === "refund_reversal");
if (!refund) {
  refund = await stripe.refunds.create(
    {
      charge: chargeId,
      amount: EXPECTED_AMOUNT_SEN,
      reason: "requested_by_customer",
      metadata: { aido_phase2_evidence: "refund_reversal" },
    },
    { idempotencyKey: `aido-phase2-refund-${chargeId}` },
  );
}
if (
  refund.livemode
  || refund.status !== "succeeded"
  || refund.amount !== EXPECTED_AMOUNT_SEN
  || refund.currency !== "myr"
) throw new Error("Stripe did not complete the expected full sandbox refund.");

const refundEvents = await stripe.events.list({
  type: "refund.created",
  created: { gte: Math.max(0, refund.created - 120) },
  limit: 100,
});
const refundEvent = refundEvents.data.find((event) => event.data.object?.id === refund.id);
if (!refundEvent || refundEvent.livemode) {
  throw new Error("Stripe did not emit the expected sandbox refund.created event.");
}

let refundPayment;
let reversal;
for (let attempt = 0; attempt < 12; attempt += 1) {
  const refundPaymentResult = await admin
    .from("aido_payment_events")
    .select("id,stripe_event_id,stripe_event_type,event_kind,related_payment_event_id,user_id,amount_gross_sen,credits_affected,status")
    .eq("stripe_event_id", refundEvent.id);
  if (refundPaymentResult.error) throw refundPaymentResult.error;
  if (refundPaymentResult.data.length === 1) {
    refundPayment = refundPaymentResult.data[0];
    const reversalResult = await admin
      .from("aido_credit_reversals")
      .select("id,credit_lot_id,payment_event_id,ledger_entry_id,reversal_type,requested_credits,recovered_credits,unrecovered_credits")
      .eq("payment_event_id", refundPayment.id);
    if (reversalResult.error) throw reversalResult.error;
    if (reversalResult.data.length === 1) {
      reversal = reversalResult.data[0];
      break;
    }
  }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
}
if (!refundPayment || !reversal) {
  throw new Error("The signed refund webhook did not persist its compensating reversal in staging.");
}

const [lotAfterResult, walletAfterResult, ledgerResult] = await Promise.all([
  admin
    .from("aido_credit_lots")
    .select("id,granted_credits,remaining_credits,reserved_credits,status")
    .eq("id", lotBefore.id)
    .single(),
  admin
    .from("aido_credit_wallets")
    .select("available_credits,reserved_credits,unrecovered_credits,status")
    .eq("user_id", originalPayment.user_id)
    .single(),
  admin
    .from("aido_credit_ledger")
    .select("id,entry_type,credit_lot_id,payment_event_id,available_delta,unrecovered_delta,available_balance_after,reserved_balance_after,unrecovered_balance_after")
    .eq("id", reversal.ledger_entry_id),
]);
if (lotAfterResult.error) throw lotAfterResult.error;
if (walletAfterResult.error) throw walletAfterResult.error;
if (ledgerResult.error) throw ledgerResult.error;
const lotAfter = lotAfterResult.data;
const walletAfter = walletAfterResult.data;
const ledger = one(ledgerResult.data, "refund ledger");
const expectedRecovered = Math.min(
  EXPECTED_CREDITS,
  lotBefore.remaining_credits - lotBefore.reserved_credits,
  walletBefore.available_credits,
);
const expectedUnrecovered = EXPECTED_CREDITS - expectedRecovered;
if (
  refundPayment.stripe_event_type !== "refund.created"
  || refundPayment.event_kind !== "refund"
  || refundPayment.related_payment_event_id !== originalPayment.id
  || refundPayment.status !== "processed"
  || refundPayment.amount_gross_sen !== EXPECTED_AMOUNT_SEN
  || refundPayment.credits_affected !== EXPECTED_CREDITS
  || reversal.reversal_type !== "refund"
  || reversal.credit_lot_id !== lotBefore.id
  || reversal.requested_credits !== EXPECTED_CREDITS
  || reversal.recovered_credits !== expectedRecovered
  || reversal.unrecovered_credits !== expectedUnrecovered
  || lotAfter.remaining_credits !== lotBefore.remaining_credits - expectedRecovered
  || ledger.entry_type !== "refund"
  || ledger.available_delta !== -expectedRecovered
  || ledger.unrecovered_delta !== expectedUnrecovered
  || walletAfter.available_credits !== walletBefore.available_credits - expectedRecovered
  || walletAfter.unrecovered_credits !== walletBefore.unrecovered_credits + expectedUnrecovered
  || (expectedUnrecovered > 0 && walletAfter.status !== "frozen")
  || walletAfter.available_credits < 0
  || walletAfter.reserved_credits < 0
  || walletAfter.unrecovered_credits < 0
) throw new Error("The refund payment, reversal, lot, ledger, or wallet did not reconcile.");

const evidence = {
  verified_at: new Date().toISOString(),
  target_environment: "staging",
  staging_project_ref: STAGING_PROJECT_REF,
  stripe_account_id: account.id,
  stripe_mode: "test",
  original_charge_id: chargeId,
  refund_id: refund.id,
  refund_event_id: refundEvent.id,
  refund: {
    status: refund.status,
    amount_sen: refund.amount,
    currency: refund.currency,
  },
  persistence: {
    requested_credits: reversal.requested_credits,
    recovered_credits: reversal.recovered_credits,
    unrecovered_credits: reversal.unrecovered_credits,
    lot_before: lotBefore,
    lot_after: lotAfter,
    wallet_before: walletBefore,
    wallet_after: walletAfter,
    ledger_entry_type: ledger.entry_type,
    balances_nonnegative: true,
  },
  account_id_sha256: createHash("sha256").update(originalPayment.user_id).digest("hex"),
};
await mkdir(dirname(resolvedOutputPath), { recursive: true, mode: 0o700 });
await writeFile(resolvedOutputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
await chmod(resolvedOutputPath, 0o600);
console.log(JSON.stringify({
  passed: true,
  refund_id: refund.id,
  refund_event_id: refundEvent.id,
  requested_credits: reversal.requested_credits,
  recovered_credits: reversal.recovered_credits,
  unrecovered_credits: reversal.unrecovered_credits,
  wallet_status: walletAfter.status,
  wallet_available_credits: walletAfter.available_credits,
  output_path: resolvedOutputPath,
}, null, 2));
