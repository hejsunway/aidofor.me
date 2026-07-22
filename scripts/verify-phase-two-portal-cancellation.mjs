import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const STAGING_PROJECT_REF = "vokjkogzvtohdinhxhkk";
const STAGING_SUPABASE_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;
const STRIPE_ACCOUNT_ID = "acct_1Tv6yz1tdTVob40G";

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

const envPath = option("--env-file");
const subscriptionId = option("--subscription-id");
const outputPath = option("--output");
if (!envPath || !outputPath || !/^sub_[A-Za-z0-9]+$/.test(subscriptionId ?? "")) {
  throw new Error(
    "Usage: pnpm phase2:verify-portal-cancellation -- --env-file /absolute/path/.env.staging.local --subscription-id sub_... --output /absolute/private/path/portal-cancellation-evidence.json",
  );
}

const resolvedOutputPath = outsideRepository(outputPath, "Portal-cancellation evidence");
const envValues = parseEnvFile(await readFile(resolve(envPath), "utf8"));
const supabaseUrl = requireValue(envValues, "NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
const billingTarget = requireValue(envValues, "AIDO_BILLING_CONFIG_TARGET");
const serviceRoleKey = requireValue(envValues, "SUPABASE_SERVICE_ROLE_KEY");
const stripeKey = requireValue(envValues, "STRIPE_SECRET_KEY");
if (supabaseUrl !== STAGING_SUPABASE_URL || billingTarget !== "staging") {
  throw new Error("The portal-cancellation verifier must target isolated AidoForMe staging exactly.");
}
if (!stripeKey.startsWith("sk_test_") && !stripeKey.startsWith("rk_test_")) {
  throw new Error("The portal-cancellation verifier requires a Stripe sandbox key.");
}

const stripe = new Stripe(stripeKey);
const [account, subscription] = await Promise.all([
  stripe.accounts.retrieve(),
  stripe.subscriptions.retrieve(subscriptionId),
]);
if (account.id !== STRIPE_ACCOUNT_ID || subscription.livemode) {
  throw new Error("The subscription does not belong to the approved AidoForMe sandbox.");
}
const subscriptionItem = subscription.items.data.length === 1 ? subscription.items.data[0] : null;
const cancelsAtPeriodEnd = Boolean(
  subscriptionItem
  && subscription.cancel_at
  && subscription.cancel_at === subscriptionItem.current_period_end,
);
if (!subscriptionItem || (!subscription.cancel_at_period_end && !cancelsAtPeriodEnd)) {
  throw new Error("Stripe does not show an end-of-period cancellation.");
}

const events = await stripe.events.list({
  type: "customer.subscription.updated",
  created: { gte: Math.max(0, subscription.created - 120) },
  limit: 100,
});
const cancellationEvent = events.data
  .filter((event) => event.data.object?.id === subscriptionId)
  .find((event) => (
    event.data.object?.cancel_at_period_end === true
    || event.data.object?.cancel_at === subscriptionItem.current_period_end
  ));
if (!cancellationEvent || cancellationEvent.livemode) {
  throw new Error("Stripe did not expose the sandbox customer.subscription.updated cancellation event.");
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
let projection;
let journal;
for (let attempt = 0; attempt < 12; attempt += 1) {
  const [projectionResult, journalResult] = await Promise.all([
    admin
      .from("aido_subscriptions")
      .select("user_id,status,cancel_at_period_end,cancel_at,current_period_end,last_stripe_event_id,last_stripe_event_type")
      .eq("stripe_subscription_id", subscriptionId)
      .single(),
    admin
      .from("aido_subscription_events")
      .select("stripe_event_id,stripe_event_type,subscription_status,projection_applied,event_created_at")
      .eq("stripe_event_id", cancellationEvent.id),
  ]);
  if (projectionResult.error) throw projectionResult.error;
  if (journalResult.error) throw journalResult.error;
  projection = projectionResult.data;
  journal = journalResult.data;
  if (projection.cancel_at && journal.length === 1) break;
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
}
if (!projection?.user_id || !projection.cancel_at || journal?.length !== 1) {
  throw new Error("The signed portal cancellation webhook was not persisted in staging.");
}

const [walletResult, cancellationPaymentsResult] = await Promise.all([
  admin
    .from("aido_credit_wallets")
    .select("available_credits,reserved_credits,unrecovered_credits,status")
    .eq("user_id", projection.user_id)
    .single(),
  admin
    .from("aido_payment_events")
    .select("id")
    .eq("stripe_event_id", cancellationEvent.id),
]);
if (walletResult.error) throw walletResult.error;
if (cancellationPaymentsResult.error) throw cancellationPaymentsResult.error;
const wallet = walletResult.data;
const expectedStripeCancelAt = new Date(subscription.cancel_at * 1000).toISOString();
if (
  projection.status !== subscription.status
  || projection.last_stripe_event_id !== cancellationEvent.id
  || projection.last_stripe_event_type !== "customer.subscription.updated"
  || new Date(projection.cancel_at).toISOString() !== expectedStripeCancelAt
  || new Date(projection.current_period_end).valueOf() !== subscriptionItem.current_period_end * 1000
  || !journal[0].projection_applied
  || cancellationPaymentsResult.data.length !== 0
  || wallet.available_credits < 0
  || wallet.reserved_credits < 0
  || wallet.unrecovered_credits < 0
) throw new Error("The portal cancellation projection or zero-financial-effect evidence did not reconcile.");

const evidence = {
  verified_at: new Date().toISOString(),
  target_environment: "staging",
  staging_project_ref: STAGING_PROJECT_REF,
  stripe_account_id: account.id,
  stripe_mode: "test",
  subscription_id: subscriptionId,
  cancellation_event_id: cancellationEvent.id,
  stripe: {
    status: subscription.status,
    cancel_at_period_end: subscription.cancel_at_period_end,
    cancellation_schedule: subscription.cancel_at_period_end ? "period_end_flag" : "explicit_period_end_timestamp",
    cancel_at: expectedStripeCancelAt,
  },
  persistence: {
    status: projection.status,
    cancel_at_period_end: projection.cancel_at_period_end,
    cancel_at: projection.cancel_at,
    journal_event_type: journal[0].stripe_event_type,
    financial_effect_count: cancellationPaymentsResult.data.length,
    wallet,
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
  subscription_id: subscriptionId,
  cancellation_event_id: cancellationEvent.id,
  cancel_at: expectedStripeCancelAt,
  financial_effect_count: cancellationPaymentsResult.data.length,
  wallet_available_credits: wallet.available_credits,
  output_path: resolvedOutputPath,
}, null, 2));
