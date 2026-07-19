import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

let apiUrl = process.env.API_URL;
let serviceRoleKey = process.env.SERVICE_ROLE_KEY;
const allowReset = process.env.AIDO_ALLOW_LOCAL_DB_RESET === "1";

if (!apiUrl || !serviceRoleKey) {
  const statusOutput = execFileSync(
    "pnpm",
    ["supabase", "status", "--output", "json"],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  const jsonStart = statusOutput.indexOf("{");
  if (jsonStart < 0) throw new Error("Could not read local Supabase status.");
  const localStatus = JSON.parse(statusOutput.slice(jsonStart));
  apiUrl ??= localStatus.API_URL;
  serviceRoleKey ??= localStatus.SERVICE_ROLE_KEY;
}

if (!apiUrl || !serviceRoleKey) {
  throw new Error("Local Supabase API_URL and SERVICE_ROLE_KEY are required.");
}

const parsedApiUrl = new URL(apiUrl);
if (!["127.0.0.1", "localhost"].includes(parsedApiUrl.hostname) || !allowReset) {
  throw new Error(
    "Phase 2 concurrency tests require a local Supabase URL and AIDO_ALLOW_LOCAL_DB_RESET=1 because the isolated database is reset afterward.",
  );
}

const admin = createClient(apiUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const password = `Aido-${randomUUID()}-9a`;
const suffix = randomUUID();
const email = `phase2-concurrency-${suffix}@example.test`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function resetLocalDatabase() {
  execFileSync("pnpm", ["supabase", "db", "reset", "--local", "--no-seed"], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
}

async function insert(table, values) {
  const { error } = await admin.from(table).insert(values);
  if (error) throw error;
}

async function rpc(name, parameters) {
  const result = await admin.rpc(name, parameters);
  if (result.error) throw result.error;
  return result.data;
}

function reservationId(data) {
  const row = Array.isArray(data) ? data[0] : data;
  return row?.reservation_id;
}

let testError;

try {
  const { count: existingConfigCount, error: existingConfigError } = await admin
    .from("aido_billing_config_versions")
    .select("id", { count: "exact", head: true });
  if (existingConfigError) throw existingConfigError;
  assert(existingConfigCount === 0, "Concurrency test requires a clean isolated local database.");

  const { data: created, error: createUserError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createUserError || !created.user) {
    throw createUserError ?? new Error("Could not create the concurrency-test user.");
  }
  const userId = created.user.id;

  const billingConfigId = randomUUID();
  const providerPriceId = randomUUID();
  const rateCardId = randomUUID();
  const routeId = randomUUID();
  const effectiveFrom = new Date(Date.now() - 60_000).toISOString();

  await insert("aido_product_memberships", {
    user_id: userId,
    status: "active",
    role: "student",
  });
  await insert("aido_billing_config_versions", {
    id: billingConfigId,
    version: 1,
    credits_per_retail_myr: 10,
    net_revenue_sen_per_1000_credits: 10_000,
    provider_cost_target_bps: 3_000,
    quote_safety_multiplier_bps: 12_500,
    payment_risk_reserve_bps: 500,
    budget_myr_sen_per_usd: 450,
    minimum_topup_sen: 500,
    effective_from: effectiveFrom,
  });
  await insert("aido_provider_prices", {
    id: providerPriceId,
    provider: "openai",
    model: "gpt-concurrency-test",
    version: 1,
    input_microusd_per_million_tokens: 1_000_000,
    output_microusd_per_million_tokens: 2_000_000,
    effective_from: effectiveFrom,
    source_reference: "isolated-local-concurrency-test",
  });
  await insert("aido_feature_rate_cards", {
    id: rateCardId,
    feature_key: "assignment.autopilot",
    version: 1,
    billing_config_id: billingConfigId,
    base_credits: 10,
    minimum_credits: 10,
    maximum_credits: 100,
    max_provider_cost_microusd: 5_000,
    max_input_tokens: 10_000,
    max_output_tokens: 10_000,
    max_tool_calls: 4,
    max_search_calls: 4,
    max_pages: 20,
    max_sources: 20,
    max_retries: 2,
    timeout_ms: 120_000,
    daily_user_credit_cap: 1_000,
    concurrent_job_cap: 5,
    effective_from: effectiveFrom,
  });
  await insert("aido_provider_routes", {
    id: routeId,
    feature_rate_card_id: rateCardId,
    provider_price_id: providerPriceId,
    priority: 1,
    evaluation_reference: "isolated-local-concurrency-test",
    privacy_policy_version: "test-v1",
    approved: true,
    effective_from: effectiveFrom,
  });
  await insert("aido_system_controls", [
    {
      scope_type: "global",
      scope_key: "*",
      is_enabled: true,
      daily_provider_budget_microusd: 100_000,
      max_concurrent_calls: 10,
    },
    {
      scope_type: "feature",
      scope_key: "assignment.autopilot",
      is_enabled: true,
      daily_provider_budget_microusd: 100_000,
      max_concurrent_calls: 10,
    },
    {
      scope_type: "provider",
      scope_key: "openai",
      is_enabled: true,
      daily_provider_budget_microusd: 100_000,
      max_concurrent_calls: 10,
    },
    {
      scope_type: "model",
      scope_key: "openai/gpt-concurrency-test",
      is_enabled: true,
      daily_provider_budget_microusd: 100_000,
      max_concurrent_calls: 10,
    },
  ]);

  await rpc("aido_grant_credits", {
    p_user_id: userId,
    p_amount: 100,
    p_source: "admin",
    p_expires_at: null,
    p_idempotency_key: `concurrency-grant-${suffix}`,
    p_payment_event_id: null,
    p_credit_product_id: null,
  });

  const sharedExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const sharedReservation = {
    p_user_id: userId,
    p_project_id: null,
    p_feature_key: "assignment.autopilot",
    p_feature_rate_card_id: rateCardId,
    p_provider_route_id: routeId,
    p_job_key: `concurrency-shared-job-${suffix}`,
    p_idempotency_key: `concurrency-shared-reservation-${suffix}`,
    p_quoted_credits: 60,
    p_maximum_credits: 80,
    p_provider_budget_microusd: 1_000,
    p_expires_at: sharedExpiry,
  };

  const duplicateResults = await Promise.all([
    admin.rpc("aido_reserve_credits", sharedReservation),
    admin.rpc("aido_reserve_credits", sharedReservation),
  ]);
  assert(duplicateResults.every((result) => !result.error), "Concurrent duplicate reservation failed.");
  const duplicateIds = duplicateResults.map((result) => reservationId(result.data));
  assert(duplicateIds[0] && duplicateIds[0] === duplicateIds[1], "Duplicate requests returned different reservations.");

  const { count: sharedCount, error: sharedCountError } = await admin
    .from("aido_usage_reservations")
    .select("id", { count: "exact", head: true })
    .eq("idempotency_key", sharedReservation.p_idempotency_key);
  if (sharedCountError) throw sharedCountError;
  assert(sharedCount === 1, "Concurrent duplicate reservation inserted more than one row.");

  const { count: sharedLedgerCount, error: sharedLedgerError } = await admin
    .from("aido_credit_ledger")
    .select("id", { count: "exact", head: true })
    .eq("reservation_id", duplicateIds[0])
    .eq("entry_type", "reserve");
  if (sharedLedgerError) throw sharedLedgerError;
  assert(sharedLedgerCount === 1, "Concurrent duplicate reservation appended more than one reserve entry.");

  await rpc("aido_release_reservation", {
    p_reservation_id: duplicateIds[0],
    p_terminal_status: "released",
    p_failure_category: null,
    p_idempotency_key: `concurrency-shared-release-${suffix}`,
  });

  const distinctExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const baseDistinct = {
    p_user_id: userId,
    p_project_id: null,
    p_feature_key: "assignment.autopilot",
    p_feature_rate_card_id: rateCardId,
    p_provider_route_id: routeId,
    p_quoted_credits: 60,
    p_maximum_credits: 80,
    p_provider_budget_microusd: 1_000,
    p_expires_at: distinctExpiry,
  };
  const distinctResults = await Promise.all([
    admin.rpc("aido_reserve_credits", {
      ...baseDistinct,
      p_job_key: `concurrency-distinct-a-${suffix}`,
      p_idempotency_key: `concurrency-distinct-reservation-a-${suffix}`,
    }),
    admin.rpc("aido_reserve_credits", {
      ...baseDistinct,
      p_job_key: `concurrency-distinct-b-${suffix}`,
      p_idempotency_key: `concurrency-distinct-reservation-b-${suffix}`,
    }),
  ]);

  const successes = distinctResults.filter((result) => !result.error);
  const failures = distinctResults.filter((result) => result.error);
  assert(successes.length === 1, "Two distinct concurrent reservations both spent the same credits.");
  assert(failures.length === 1, "One distinct concurrent reservation was not rejected.");
  assert(failures[0].error.code === "P0001", "Concurrent overspend failed with an unexpected database error.");

  const winningReservationId = reservationId(successes[0].data);
  const { data: reservedWallet, error: reservedWalletError } = await admin
    .from("aido_credit_wallets")
    .select("available_credits,reserved_credits")
    .eq("user_id", userId)
    .single();
  if (reservedWalletError) throw reservedWalletError;
  assert(
    reservedWallet.available_credits === 20 && reservedWallet.reserved_credits === 80,
    "Concurrent reservation did not preserve the 100-credit wallet invariant.",
  );

  await rpc("aido_release_reservation", {
    p_reservation_id: winningReservationId,
    p_terminal_status: "released",
    p_failure_category: null,
    p_idempotency_key: `concurrency-winning-release-${suffix}`,
  });

  const { data: finalWallet, error: finalWalletError } = await admin
    .from("aido_credit_wallets")
    .select("available_credits,reserved_credits,unrecovered_credits")
    .eq("user_id", userId)
    .single();
  if (finalWalletError) throw finalWalletError;
  assert(
    finalWallet.available_credits === 100 &&
      finalWallet.reserved_credits === 0 &&
      finalWallet.unrecovered_credits === 0,
    "Released concurrent reservations did not fully reconcile the wallet.",
  );

  const { data: budgets, error: budgetError } = await admin
    .from("aido_provider_budget_usage")
    .select("reserved_microusd,incurred_microusd");
  if (budgetError) throw budgetError;
  assert(
    budgets.length === 4 && budgets.every((row) => row.reserved_microusd === 0 && row.incurred_microusd === 0),
    "Concurrent reservations did not reconcile all provider budget scopes.",
  );

  console.log("Phase 2 atomic concurrency flow passed.");
} catch (error) {
  testError = error;
} finally {
  resetLocalDatabase();
}

if (testError) throw testError;
