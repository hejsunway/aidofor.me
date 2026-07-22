import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const STAGING_PROJECT_REF = "vokjkogzvtohdinhxhkk";
const STAGING_SUPABASE_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;
const STRIPE_ACCOUNT_ID = "acct_1Tv6yz1tdTVob40G";
const FEATURE_KEY = "assignment.requirement_extraction";

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

function outsideRepository(path) {
  const repositoryRoot = resolve(".");
  const resolvedPath = resolve(path);
  if (
    resolvedPath === repositoryRoot
    || resolvedPath.startsWith(`${repositoryRoot}${sep}`)
  ) throw new Error("Evidence must be written outside the repository.");
  return resolvedPath;
}

function ceilDiv(left, right) {
  return Math.floor((left + right - 1) / right);
}

async function exactCount(query, label) {
  const { count, error } = await query;
  if (error) throw error;
  if (!Number.isSafeInteger(count)) throw new Error(`${label} did not return an exact count.`);
  return count;
}

async function sideEffectCounts(admin, userId) {
  const [reservations, authorizations, usageEvents, ledgerEntries] = await Promise.all([
    exactCount(
      admin.from("aido_usage_reservations").select("id", { count: "exact", head: true }).eq("user_id", userId),
      "reservations",
    ),
    exactCount(
      admin.from("aido_provider_call_authorizations").select("id", { count: "exact", head: true }).eq("user_id", userId),
      "authorizations",
    ),
    exactCount(
      admin.from("aido_usage_events").select("id", { count: "exact", head: true }).eq("user_id", userId),
      "usage events",
    ),
    exactCount(
      admin.from("aido_credit_ledger").select("id", { count: "exact", head: true }).eq("user_id", userId),
      "ledger entries",
    ),
  ]);
  return { reservations, authorizations, usage_events: usageEvents, ledger_entries: ledgerEntries };
}

const envPath = option("--env-file");
const sessionId = option("--checkout-session");
const outputPath = option("--output");
if (!envPath || !sessionId || !outputPath || !/^cs_test_[A-Za-z0-9]+$/.test(sessionId)) {
  throw new Error(
    "Usage: node scripts/verify-phase-two-insufficient-credit-staging.mjs --env-file /absolute/path/.env.staging.local --checkout-session cs_test_... --output /absolute/private/path/evidence.json",
  );
}

const resolvedOutputPath = outsideRepository(outputPath);
const envValues = parseEnvFile(await readFile(resolve(envPath), "utf8"));
const supabaseUrl = requireValue(envValues, "NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
const billingTarget = requireValue(envValues, "AIDO_BILLING_CONFIG_TARGET");
const serviceRoleKey = requireValue(envValues, "SUPABASE_SERVICE_ROLE_KEY");
const stripeKey = requireValue(envValues, "STRIPE_SECRET_KEY");
if (supabaseUrl !== STAGING_SUPABASE_URL || billingTarget !== "staging") {
  throw new Error("The verifier must target isolated AidoForMe staging exactly.");
}
if (!stripeKey.startsWith("sk_test_") && !stripeKey.startsWith("rk_test_")) {
  throw new Error("The verifier requires a Stripe sandbox key.");
}

const stripe = new Stripe(stripeKey);
const [account, session] = await Promise.all([
  stripe.accounts.retrieve(),
  stripe.checkout.sessions.retrieve(sessionId),
]);
if (account.id !== STRIPE_ACCOUNT_ID) {
  throw new Error("The Stripe key does not belong to the approved AidoForMe sandbox account.");
}
const stripeCustomerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
if (
  session.livemode
  || session.mode !== "payment"
  || session.payment_status !== "unpaid"
  || session.status !== "open"
  || !stripeCustomerId
) throw new Error("The selected session must be the open, unpaid sandbox top-up checkout.");

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const customerResult = await admin
  .from("aido_payment_customers")
  .select("user_id")
  .eq("stripe_customer_id", stripeCustomerId);
if (customerResult.error) throw customerResult.error;
if (customerResult.data.length !== 1) {
  throw new Error("The Stripe customer is not mapped to exactly one staging Aido account.");
}
const userId = customerResult.data[0].user_id;

const [membershipResult, walletResult, rateResult] = await Promise.all([
  admin
    .from("aido_product_memberships")
    .select("status")
    .eq("user_id", userId)
    .eq("status", "active"),
  admin
    .from("aido_credit_wallets")
    .select("available_credits,reserved_credits,unrecovered_credits,status")
    .eq("user_id", userId),
  admin
    .from("aido_feature_rate_cards")
    .select("*,aido_provider_routes!inner(*,aido_provider_prices(*))")
    .eq("feature_key", FEATURE_KEY)
    .eq("aido_provider_routes.approved", true)
    .order("effective_from", { ascending: false })
    .limit(1),
]);
for (const result of [membershipResult, walletResult, rateResult]) {
  if (result.error) throw result.error;
}
if (membershipResult.data.length !== 1) throw new Error("The staging account has no active Aido membership.");
if (walletResult.data.length > 1) throw new Error("The staging account has duplicate wallet rows.");
const wallet = walletResult.data[0] ?? {
  available_credits: 0,
  reserved_credits: 0,
  unrecovered_credits: 0,
  status: "not_funded",
};
if (wallet.available_credits !== 0 || wallet.reserved_credits !== 0) {
  throw new Error("This check requires the real staging account to have zero available and reserved credits.");
}
if (rateResult.data.length !== 1) throw new Error("No unique effective staging rate card was found.");
const rate = rateResult.data[0];
const routes = rate.aido_provider_routes.filter((route) => route.approved);
if (routes.length !== 1 || !routes[0].aido_provider_prices) {
  throw new Error("No unique approved provider route was found.");
}
const route = routes[0];
const price = route.aido_provider_prices;

const estimate = {
  input_tokens: 1_000,
  output_tokens: 500,
  pages: 1,
  sources: 0,
  searches: 0,
  tool_calls: 0,
};
const quotedCredits = Math.max(
  rate.minimum_credits,
  rate.base_credits
    + ceilDiv(estimate.input_tokens, 1_000) * rate.credits_per_1000_input_tokens
    + ceilDiv(estimate.output_tokens, 1_000) * rate.credits_per_1000_output_tokens
    + estimate.pages * rate.credits_per_page,
);
const configResult = await admin
  .from("aido_billing_config_versions")
  .select("quote_safety_multiplier_bps")
  .eq("id", rate.billing_config_id)
  .single();
if (configResult.error) throw configResult.error;
const maximumCredits = Math.min(
  ceilDiv(quotedCredits * configResult.data.quote_safety_multiplier_bps, 10_000),
  rate.maximum_credits,
);
const maximumInputPrice = Math.max(
  price.input_microusd_per_million_tokens,
  price.cached_input_microusd_per_million_tokens,
  price.cache_write_input_microusd_per_million_tokens,
);
const estimatedCost =
  ceilDiv(estimate.input_tokens * maximumInputPrice, 1_000_000)
  + ceilDiv(estimate.output_tokens * price.output_microusd_per_million_tokens, 1_000_000);
const providerBudget = ceilDiv(
  estimatedCost * configResult.data.quote_safety_multiplier_bps,
  10_000,
);
if (
  quotedCredits < rate.minimum_credits
  || maximumCredits < quotedCredits
  || maximumCredits > rate.maximum_credits
  || providerBudget <= 0
  || providerBudget > rate.max_provider_cost_microusd
) throw new Error("The test estimate does not fit the applied staging rate card.");

const before = await sideEffectCounts(admin, userId);
const keySuffix = createHash("sha256").update(session.id).digest("hex").slice(0, 24);
const { data: reservationData, error: reservationError } = await admin.rpc("aido_reserve_credits", {
  p_user_id: userId,
  p_project_id: null,
  p_feature_key: FEATURE_KEY,
  p_feature_rate_card_id: rate.id,
  p_provider_route_id: route.id,
  p_job_key: `phase2-insufficient-job-${keySuffix}`,
  p_idempotency_key: `phase2-insufficient-reservation-${keySuffix}`,
  p_quoted_credits: quotedCredits,
  p_maximum_credits: maximumCredits,
  p_provider_budget_microusd: providerBudget,
  p_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
});
if (!reservationError || reservationData) {
  throw new Error("The zero-credit reservation unexpectedly succeeded.");
}
if (reservationError.code !== "P0001" || reservationError.message !== "Insufficient credits") {
  throw new Error(`The reservation failed for the wrong reason (${reservationError.code ?? "unknown"}).`);
}
const after = await sideEffectCounts(admin, userId);
if (JSON.stringify(before) !== JSON.stringify(after)) {
  throw new Error("The rejected reservation created a financial or provider-dispatch side effect.");
}

const evidence = {
  verified_at: new Date().toISOString(),
  target_environment: "staging",
  staging_project_ref: STAGING_PROJECT_REF,
  stripe_account_id: account.id,
  stripe_mode: "test",
  checkout_session_id: session.id,
  account_id_sha256: createHash("sha256").update(userId).digest("hex"),
  wallet_before: wallet,
  applied_route: {
    feature_key: FEATURE_KEY,
    provider: price.provider,
    model: price.model,
    quoted_credits: quotedCredits,
    maximum_credits: maximumCredits,
    provider_budget_microusd: providerBudget,
  },
  rejection: {
    database_code: reservationError.code,
    message: reservationError.message,
  },
  side_effect_counts_before: before,
  side_effect_counts_after: after,
  reservation_created: false,
  authorization_created: false,
  provider_dispatch_created: false,
  usage_event_created: false,
};

await mkdir(dirname(resolvedOutputPath), { recursive: true, mode: 0o700 });
await writeFile(resolvedOutputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
console.log(JSON.stringify({
  passed: true,
  reason: evidence.rejection.message,
  provider_dispatch_created: false,
  side_effect_counts_unchanged: true,
  private_evidence_path: resolvedOutputPath,
}, null, 2));
