import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { quoteMeteredWork, reserveMeteredWork } from "@/lib/billing/quote";
import { runMeteredProviderResponse } from "@/lib/providers/gateway";

const STAGING_PROJECT_REF = "vokjkogzvtohdinhxhkk";
const STAGING_SUPABASE_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;
const STRIPE_ACCOUNT_ID = "acct_1Tv6yz1tdTVob40G";
const FEATURE_KEY = "assignment.requirement_extraction";
const PROMPT_VERSION = "phase2-gateway-real-clause-smoke-v1";

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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseExactResponse(text, clause) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gateway response was not one JSON object.");
  }
  if (
    !parsed
    || typeof parsed !== "object"
    || Array.isArray(parsed)
    || JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify(["source_text", "source_text_sha256"])
    || parsed.source_text !== clause.source_text
    || parsed.source_text_sha256 !== clause.text_sha256
  ) throw new Error("Gateway response did not preserve the real anchored clause exactly.");
  return { source_text_sha256: parsed.source_text_sha256 };
}

const envPath = option("--env-file");
const reportPath = option("--evaluation-report");
const stripeEventId = option("--stripe-event-id");
const outputPath = option("--output");
const preflightOnly = process.argv.includes("--preflight-only");
if (
  !envPath
  || !reportPath
  || !outputPath
  || !stripeEventId
  || !/^evt_[A-Za-z0-9]+$/.test(stripeEventId)
) {
  throw new Error(
    "Usage: node --experimental-strip-types --loader ./scripts/typescript-workspace-loader.mjs scripts/execute-phase-two-gateway-staging.mjs --env-file /absolute/path/.env.staging.local --evaluation-report /absolute/private/path/evaluation.json --stripe-event-id evt_... --output /absolute/private/path/evidence.json [--preflight-only]",
  );
}
const resolvedReportPath = outsideRepository(reportPath, "Evaluation report");
const resolvedOutputPath = outsideRepository(outputPath, "Gateway evidence");
const envValues = parseEnvFile(await readFile(resolve(envPath), "utf8"));
for (const [name, value] of Object.entries(envValues)) {
  if (process.env[name] === undefined) process.env[name] = value;
}
const supabaseUrl = requireValue(envValues, "NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
const billingTarget = requireValue(envValues, "AIDO_BILLING_CONFIG_TARGET");
const serviceRoleKey = requireValue(envValues, "SUPABASE_SERVICE_ROLE_KEY");
const stripeKey = requireValue(envValues, "STRIPE_SECRET_KEY");
requireValue(envValues, "OPENAI_API_KEY");
if (supabaseUrl !== STAGING_SUPABASE_URL || billingTarget !== "staging") {
  throw new Error("The gateway execution must target isolated AidoForMe staging exactly.");
}
if (!stripeKey.startsWith("sk_test_") && !stripeKey.startsWith("rk_test_")) {
  throw new Error("The gateway execution requires the Stripe sandbox key.");
}

const reportBytes = await readFile(resolvedReportPath);
const report = JSON.parse(reportBytes.toString("utf8"));
if (
  report.target_environment !== "staging"
  || report.staging_project_ref !== STAGING_PROJECT_REF
  || report.automatic_validation?.passed !== true
  || !report.project_id
) throw new Error("The private evaluation report is not the accepted validated staging artifact.");
const clauses = report.anchor_registry
  ?.flatMap((anchor) => Array.isArray(anchor.atomic_clauses) ? anchor.atomic_clauses : [])
  ?? [];
const clause = clauses.find((candidate) => (
  typeof candidate?.source_text === "string"
  && typeof candidate?.text_sha256 === "string"
  && sha256(candidate.source_text) === candidate.text_sha256
));
if (!clause) throw new Error("The accepted report contains no hash-valid real atomic clause.");

const [stripeAccount, stripeEvent] = await Promise.all([
  new Stripe(stripeKey).accounts.retrieve(),
  new Stripe(stripeKey).events.retrieve(stripeEventId),
]);
if (
  stripeAccount.id !== STRIPE_ACCOUNT_ID
  || stripeEvent.livemode
  || stripeEvent.type !== "checkout.session.completed"
) throw new Error("The funding event is not the approved AidoForMe sandbox top-up.");

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const paymentResult = await admin
  .from("aido_payment_events")
  .select("user_id,status,credits_affected")
  .eq("stripe_event_id", stripeEventId);
if (paymentResult.error) throw paymentResult.error;
const payment = one(paymentResult.data, "funding payment");
if (payment.status !== "processed" || payment.credits_affected !== 2_000) {
  throw new Error("The real staging wallet has not been funded by the approved top-up.");
}
const projectResult = await admin
  .from("aido_writing_projects")
  .select("id,owner_id")
  .eq("id", report.project_id)
  .eq("owner_id", payment.user_id);
if (projectResult.error) throw projectResult.error;
one(projectResult.data, "developer-owned staging project");

const executionKey = sha256(`${stripeEventId}:${sha256(reportBytes)}:${clause.text_sha256}`).slice(0, 24);
const jobKey = `phase2-gateway-job-${executionKey}`;
const reservationKey = `phase2-gateway-reservation-${executionKey}`;
const existingResult = await admin
  .from("aido_usage_reservations")
  .select("id,status")
  .eq("job_key", jobKey);
if (existingResult.error) throw existingResult.error;
if (existingResult.data.length) {
  throw new Error("This real gateway execution key already exists; refusing a second provider dispatch.");
}

const walletBeforeResult = await admin
  .from("aido_credit_wallets")
  .select("available_credits,reserved_credits,unrecovered_credits,status")
  .eq("user_id", payment.user_id)
  .single();
if (walletBeforeResult.error) throw walletBeforeResult.error;
const walletBefore = walletBeforeResult.data;
const estimated = {
  inputTokens: 1_500,
  outputTokens: 300,
  pages: 1,
  sources: 1,
  searches: 0,
  toolCalls: 0,
};

const preflightQuote = await quoteMeteredWork(FEATURE_KEY, estimated);
if (preflightQuote.provider !== "openai" || preflightQuote.model !== "gpt-5.4-mini-2026-03-17") {
  throw new Error("The applied staging route is not the accepted mini snapshot.");
}
if (preflightQuote.maximumCredits > walletBefore.available_credits) {
  throw new Error("The funded staging wallet cannot cover the reviewed gateway reservation.");
}
if (preflightOnly) {
  console.log(JSON.stringify({
    passed: true,
    target_environment: "staging",
    provider: preflightQuote.provider,
    model: preflightQuote.model,
    quoted_credits: preflightQuote.quotedCredits,
    maximum_credits: preflightQuote.maximumCredits,
    estimated_provider_cost_microusd: preflightQuote.estimatedProviderCostMicrousd,
    provider_budget_microusd: preflightQuote.providerBudgetMicrousd,
    wallet_available_credits: walletBefore.available_credits,
    provider_request_created: false,
  }, null, 2));
  process.exit(0);
}

const { quote, reservation } = await reserveMeteredWork({
  userId: payment.user_id,
  projectId: report.project_id,
  featureKey: FEATURE_KEY,
  estimate: estimated,
  jobKey,
  idempotencyKey: reservationKey,
});
if (quote.provider !== "openai" || quote.model !== "gpt-5.4-mini-2026-03-17") {
  throw new Error("The reservation did not select the accepted isolated-staging mini route.");
}

const result = await runMeteredProviderResponse({
  reservationId: reservation.reservation_id,
  callIdempotencyKey: `phase2-gateway-call-${executionKey}`,
  usageIdempotencyKey: `phase2-gateway-usage-${executionKey}`,
  settlementIdempotencyKey: `phase2-gateway-settlement-${executionKey}`,
  promptVersion: PROMPT_VERSION,
  attempt: 1,
  estimated,
  instructions: [
    "Validate transport and source preservation for one developer-owned staging clause.",
    "Return exactly one JSON object with keys source_text and source_text_sha256.",
    "Copy both supplied values exactly. Do not add Markdown, commentary, or inferred text.",
  ].join(" "),
  messages: [{
    role: "user",
    content: `source_text=${JSON.stringify(clause.source_text)}\nsource_text_sha256=${clause.text_sha256}`,
  }],
  validate: async ({ text }) => parseExactResponse(text, clause),
});

const [reservationResult, authorizationResult, usageResult, ledgerResult, walletAfterResult] = await Promise.all([
  admin
    .from("aido_usage_reservations")
    .select("id,status,quoted_credits,maximum_credits,captured_credits,released_credits,provider_budget_microusd,actual_provider_cost_microusd,started_at,settled_at,released_at")
    .eq("id", reservation.reservation_id),
  admin
    .from("aido_provider_call_authorizations")
    .select("id,status,attempt,estimated_cost_microusd,dispatched_at,usage_event_id")
    .eq("reservation_id", reservation.reservation_id),
  admin
    .from("aido_usage_events")
    .select("id,provider,model,provider_request_id,prompt_version,input_tokens,cached_input_tokens,cache_write_input_tokens,output_tokens,tool_calls,search_calls,processed_pages,latency_ms,provider_cost_microusd,outcome,billable_to_student,failure_category")
    .eq("reservation_id", reservation.reservation_id),
  admin
    .from("aido_credit_ledger")
    .select("id,entry_type,available_delta,reserved_delta,available_balance_after,reserved_balance_after,unrecovered_balance_after")
    .eq("reservation_id", reservation.reservation_id)
    .order("id", { ascending: true }),
  admin
    .from("aido_credit_wallets")
    .select("available_credits,reserved_credits,unrecovered_credits,status")
    .eq("user_id", payment.user_id)
    .single(),
]);
for (const queryResult of [reservationResult, authorizationResult, usageResult, ledgerResult, walletAfterResult]) {
  if (queryResult.error) throw queryResult.error;
}
const persistedReservation = one(reservationResult.data, "persisted reservation");
const authorization = one(authorizationResult.data, "provider authorization");
const usage = one(usageResult.data, "usage event");
const walletAfter = walletAfterResult.data;
const expectedLedgerTypes = persistedReservation.released_credits > 0
  ? ["reserve", "capture", "release"]
  : ["reserve", "capture"];
if (
  persistedReservation.status !== "settled"
  || persistedReservation.captured_credits <= 0
  || persistedReservation.captured_credits + persistedReservation.released_credits !== persistedReservation.maximum_credits
  || !persistedReservation.started_at
  || !persistedReservation.settled_at
  || !persistedReservation.released_at
  || authorization.status !== "consumed"
  || authorization.attempt !== 1
  || !authorization.dispatched_at
  || !authorization.usage_event_id
  || usage.outcome !== "succeeded"
  || !usage.billable_to_student
  || usage.failure_category !== null
  || usage.provider !== "openai"
  || usage.model !== quote.model
  || usage.provider_request_id !== result.responseId
  || usage.prompt_version !== PROMPT_VERSION
  || usage.provider_cost_microusd !== persistedReservation.actual_provider_cost_microusd
  || JSON.stringify(ledgerResult.data.map((row) => row.entry_type)) !== JSON.stringify(expectedLedgerTypes)
  || walletAfter.available_credits !== walletBefore.available_credits - persistedReservation.captured_credits
  || walletAfter.reserved_credits !== walletBefore.reserved_credits
  || walletAfter.unrecovered_credits !== walletBefore.unrecovered_credits
) throw new Error("The funded gateway call did not reconcile its reservation, dispatch, usage, settlement, release, ledger, and wallet facts.");
for (const balance of [
  walletAfter.available_credits,
  walletAfter.reserved_credits,
  walletAfter.unrecovered_credits,
  ...ledgerResult.data.flatMap((row) => [
    row.available_balance_after,
    row.reserved_balance_after,
    row.unrecovered_balance_after,
  ]),
]) {
  if (!Number.isSafeInteger(balance) || balance < 0) throw new Error("A gateway wallet or ledger balance is negative.");
}

const evidence = {
  verified_at: new Date().toISOString(),
  target_environment: "staging",
  staging_project_ref: STAGING_PROJECT_REF,
  report_sha256: sha256(reportBytes),
  source_text_sha256: clause.text_sha256,
  project_id_sha256: sha256(report.project_id),
  account_id_sha256: sha256(payment.user_id),
  funding_stripe_event_id: stripeEventId,
  route: {
    feature_key: quote.featureKey,
    provider: quote.provider,
    model: quote.model,
    quoted_credits: quote.quotedCredits,
    maximum_credits: quote.maximumCredits,
    estimated_provider_cost_microusd: quote.estimatedProviderCostMicrousd,
    provider_budget_microusd: quote.providerBudgetMicrousd,
  },
  provider: {
    response_id: result.responseId,
    input_tokens: usage.input_tokens,
    cached_input_tokens: usage.cached_input_tokens,
    cache_write_input_tokens: usage.cache_write_input_tokens,
    output_tokens: usage.output_tokens,
    tool_calls: usage.tool_calls,
    search_calls: usage.search_calls,
    processed_pages: usage.processed_pages,
    latency_ms: usage.latency_ms,
    cost_microusd: usage.provider_cost_microusd,
    output_validation_passed: true,
    request_count: 1,
    retry_count: 0,
    fallback_used: false,
  },
  persistence: {
    reservation_status: persistedReservation.status,
    authorization_status: authorization.status,
    dispatch_recorded: Boolean(authorization.dispatched_at),
    usage_outcome: usage.outcome,
    captured_credits: persistedReservation.captured_credits,
    released_credits: persistedReservation.released_credits,
    ledger_entry_types: ledgerResult.data.map((row) => row.entry_type),
    wallet_before: walletBefore,
    wallet_after: walletAfter,
    balances_nonnegative: true,
  },
};

await mkdir(dirname(resolvedOutputPath), { recursive: true, mode: 0o700 });
await writeFile(resolvedOutputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
console.log(JSON.stringify({
  passed: true,
  provider_response_id: result.responseId,
  provider_cost_microusd: usage.provider_cost_microusd,
  captured_credits: persistedReservation.captured_credits,
  released_credits: persistedReservation.released_credits,
  wallet_available_after: walletAfter.available_credits,
  request_count: 1,
  retry_count: 0,
  private_evidence_path: resolvedOutputPath,
}, null, 2));
