import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { createClient } from "@supabase/supabase-js";

const STAGING_PROJECT_REF = "vokjkogzvtohdinhxhkk";
const STAGING_SUPABASE_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;
const STAGING_APP_URL = "https://aidofor-me-2afl.vercel.app";
const DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]+$/;

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
const expectedAfter = option("--expected-after");
const deploymentId = option("--vercel-deployment-id");
const outputPath = option("--output");
const vercelLogObserved = process.argv.includes("--vercel-log-observed");
if (
  !envPath
  || !outputPath
  || !expectedAfter
  || Number.isNaN(new Date(expectedAfter).valueOf())
  || !DEPLOYMENT_ID_PATTERN.test(deploymentId ?? "")
  || !vercelLogObserved
) {
  throw new Error(
    "Usage: pnpm phase2:verify-scheduled-cron -- --env-file /absolute/path/.env.staging.local --expected-after ISO_TIMESTAMP --vercel-deployment-id dpl_... --vercel-log-observed --output /absolute/private/path/scheduled-cron-evidence.json",
  );
}

const resolvedOutputPath = outsideRepository(outputPath, "Scheduled-cron evidence");
const envValues = parseEnvFile(await readFile(resolve(envPath), "utf8"));
const supabaseUrl = requireValue(envValues, "NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
const billingTarget = requireValue(envValues, "AIDO_BILLING_CONFIG_TARGET");
const serviceRoleKey = requireValue(envValues, "SUPABASE_SERVICE_ROLE_KEY");
const stripeKey = requireValue(envValues, "STRIPE_SECRET_KEY");
if (supabaseUrl !== STAGING_SUPABASE_URL || billingTarget !== "staging") {
  throw new Error("The scheduled-cron verifier must target isolated AidoForMe staging exactly.");
}
if (!stripeKey.startsWith("sk_test_") && !stripeKey.startsWith("rk_test_")) {
  throw new Error("The scheduled-cron verifier requires a Stripe sandbox key.");
}

const unauthorized = {};
for (const route of ["maintenance", "reconcile"]) {
  const response = await fetch(`${STAGING_APP_URL}/api/internal/${route}`, {
    method: "GET",
    redirect: "manual",
  });
  unauthorized[route] = response.status;
  if (response.status !== 401) {
    throw new Error(`${route} did not reject an unauthenticated browser-equivalent request.`);
  }
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const afterIso = new Date(expectedAfter).toISOString();
const runResult = await admin
  .from("aido_reconciliation_runs")
  .select("id,scope,status,internal_checked_count,stripe_checked_count,invoice_checked_count,issue_count,failure_code,started_at,completed_at")
  .gte("started_at", afterIso)
  .order("started_at", { ascending: true });
if (runResult.error) throw runResult.error;
if (runResult.data.length !== 1) {
  throw new Error(`Expected exactly one reconciliation run after ${afterIso}; found ${runResult.data.length}.`);
}
const run = runResult.data[0];
const issueRowsResult = await admin
  .from("aido_reconciliation_run_issues")
  .select("id", { count: "exact", head: true })
  .eq("run_id", run.id);
if (issueRowsResult.error) throw issueRowsResult.error;
if (
  run.scope !== "scheduled"
  || run.status !== "completed"
  || run.failure_code !== null
  || !run.completed_at
  || issueRowsResult.count !== run.issue_count
) throw new Error("The scheduler-timed reconciliation run did not complete durably.");

const evidence = {
  verified_at: new Date().toISOString(),
  target_environment: "staging",
  staging_project_ref: STAGING_PROJECT_REF,
  staging_app_url: STAGING_APP_URL,
  vercel_deployment_id: deploymentId,
  expected_after: afterIso,
  attribution: {
    invocation_kind: "vercel_cron_dashboard_run",
    deployment_runtime_log_observed: true,
    reconciliation_started_after_expected_time: true,
  },
  unauthenticated_requests: unauthorized,
  reconciliation: {
    run_id: run.id,
    scope: run.scope,
    status: run.status,
    internal_checked_count: run.internal_checked_count,
    stripe_checked_count: run.stripe_checked_count,
    invoice_checked_count: run.invoice_checked_count,
    issue_count: run.issue_count,
    issue_row_count: issueRowsResult.count,
    failure_code: run.failure_code,
    started_at: run.started_at,
    completed_at: run.completed_at,
  },
};
await mkdir(dirname(resolvedOutputPath), { recursive: true, mode: 0o700 });
await writeFile(resolvedOutputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
await chmod(resolvedOutputPath, 0o600);
console.log(JSON.stringify({
  passed: true,
  vercel_deployment_id: deploymentId,
  reconciliation_run_id: run.id,
  issue_count: run.issue_count,
  started_at: run.started_at,
  unauthorized,
  output_path: resolvedOutputPath,
}, null, 2));
