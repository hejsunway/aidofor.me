import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

const STAGING_PROJECT_REF = "vokjkogzvtohdinhxhkk";
const EXPECTED_MODEL = "gpt-5.4-mini-2026-03-17";
const INPUT_MICROUSD_PER_MILLION = 750_000;
const CACHED_INPUT_MICROUSD_PER_MILLION = 75_000;
const OUTPUT_MICROUSD_PER_MILLION = 4_500_000;

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

function outsideRepository(path, label) {
  const repositoryRoot = resolve(".");
  const resolvedPath = resolve(path);
  if (
    resolvedPath === repositoryRoot
    || resolvedPath.startsWith(`${repositoryRoot}${sep}`)
  ) throw new Error(`${label} must be outside the repository.`);
  return resolvedPath;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function calculateCostMicrousd({ inputTokens, cachedInputTokens, outputTokens }) {
  if (cachedInputTokens > inputTokens) {
    throw new Error("OpenAI reported more cached input tokens than total input tokens.");
  }
  const uncachedInputTokens = inputTokens - cachedInputTokens;
  return Math.ceil((
    uncachedInputTokens * INPUT_MICROUSD_PER_MILLION
    + cachedInputTokens * CACHED_INPUT_MICROUSD_PER_MILLION
    + outputTokens * OUTPUT_MICROUSD_PER_MILLION
  ) / 1_000_000);
}

async function getOpenAIJson(path, adminKey, parameters) {
  const url = new URL(path, "https://api.openai.com");
  for (const [name, values] of Object.entries(parameters)) {
    for (const value of Array.isArray(values) ? values : [values]) {
      url.searchParams.append(name, String(value));
    }
  }
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${adminKey}`,
      "Content-Type": "application/json",
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof body?.error?.message === "string"
      ? body.error.message
      : `OpenAI returned HTTP ${response.status}.`;
    throw new Error(`OpenAI organization export failed: ${message}`);
  }
  return body;
}

const envPath = option("--env-file");
const evidencePath = option("--gateway-evidence");
const outputPath = option("--output");
if (!envPath || !evidencePath || !outputPath) {
  throw new Error(
    "Usage: pnpm phase2:export-openai-usage -- --env-file /absolute/path/.env.staging.local --gateway-evidence /absolute/private/path/gateway-evidence.json --output /absolute/private/path/openai-usage-import.json",
  );
}

const resolvedEvidencePath = outsideRepository(evidencePath, "Gateway evidence");
const resolvedOutputPath = outsideRepository(outputPath, "OpenAI usage export");
const envValues = parseEnvFile(await readFile(resolve(envPath), "utf8"));
const adminKey = envValues.OPENAI_ADMIN_KEY || process.env.OPENAI_ADMIN_KEY;
if (!adminKey) {
  throw new Error(
    "OPENAI_ADMIN_KEY is missing. Add an organization admin key to the local staging environment; never paste it into chat or commit it.",
  );
}
const expectedSupabaseUrl = `https://${STAGING_PROJECT_REF}.supabase.co`;
if (
  (envValues.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/$/, "")
    !== expectedSupabaseUrl
  || (envValues.AIDO_BILLING_CONFIG_TARGET || process.env.AIDO_BILLING_CONFIG_TARGET) !== "staging"
) throw new Error("The OpenAI export is restricted to isolated AidoForMe staging.");

const evidenceBytes = await readFile(resolvedEvidencePath);
const evidence = JSON.parse(evidenceBytes.toString("utf8"));
const verifiedAt = new Date(evidence.verified_at);
if (
  evidence.target_environment !== "staging"
  || evidence.staging_project_ref !== STAGING_PROJECT_REF
  || evidence.route?.provider !== "openai"
  || evidence.route?.model !== EXPECTED_MODEL
  || evidence.provider?.request_count !== 1
  || evidence.provider?.retry_count !== 0
  || evidence.provider?.fallback_used !== false
  || !Number.isFinite(verifiedAt.valueOf())
) throw new Error("The gateway evidence is not the approved single-request staging artifact.");

const expectedInputTokens = requireNonNegativeInteger(evidence.provider.input_tokens, "input_tokens");
const expectedCachedInputTokens = requireNonNegativeInteger(
  evidence.provider.cached_input_tokens,
  "cached_input_tokens",
);
const expectedOutputTokens = requireNonNegativeInteger(evidence.provider.output_tokens, "output_tokens");
const expectedCostMicrousd = requireNonNegativeInteger(evidence.provider.cost_microusd, "cost_microusd");
const minuteStart = Math.floor(verifiedAt.valueOf() / 60_000) * 60;
const minuteEnd = minuteStart + 60;

const usageExport = await getOpenAIJson(
  "/v1/organization/usage/completions",
  adminKey,
  {
    start_time: minuteStart,
    end_time: minuteEnd,
    bucket_width: "1m",
    limit: 1,
    group_by: ["project_id", "model"],
  },
);
if (usageExport?.has_more) {
  throw new Error("The exact one-minute OpenAI usage export unexpectedly requires pagination.");
}
const buckets = Array.isArray(usageExport?.data) ? usageExport.data : [];
const candidates = buckets.flatMap((bucket) => (
  Array.isArray(bucket?.results)
    ? bucket.results.map((result) => ({ bucket, result }))
    : []
)).filter(({ bucket, result }) => (
  bucket.start_time === minuteStart
  && bucket.end_time === minuteEnd
  && result.model === EXPECTED_MODEL
  && result.num_model_requests === 1
  && result.input_tokens === expectedInputTokens
  && result.input_cached_tokens === expectedCachedInputTokens
  && result.output_tokens === expectedOutputTokens
));
if (candidates.length !== 1) {
  throw new Error(
    `Expected exactly one matching OpenAI usage result in the exact minute; found ${candidates.length}.`,
  );
}
const selected = candidates[0].result;
const calculatedCostMicrousd = calculateCostMicrousd({
  inputTokens: selected.input_tokens,
  cachedInputTokens: selected.input_cached_tokens,
  outputTokens: selected.output_tokens,
});
if (calculatedCostMicrousd !== expectedCostMicrousd) {
  throw new Error(
    `The exported usage calculates to ${calculatedCostMicrousd} microusd, not the ${expectedCostMicrousd} microusd persisted by the gateway.`,
  );
}

const exportSha256 = sha256(JSON.stringify(usageExport));
const importArtifact = {
  provider: "openai",
  invoice_reference: `openai-usage-1m-${minuteStart}-${exportSha256.slice(0, 16)}`,
  period_start: new Date(minuteStart * 1_000).toISOString(),
  period_end: new Date(minuteEnd * 1_000).toISOString(),
  billed_microusd: calculatedCostMicrousd,
  currency: "USD",
  source_kind: "openai_organization_usage_completions_1m",
  source_export_sha256: exportSha256,
  gateway_evidence_sha256: sha256(evidenceBytes),
  selected_usage: {
    project_id: selected.project_id,
    model: selected.model,
    input_tokens: selected.input_tokens,
    input_cached_tokens: selected.input_cached_tokens,
    output_tokens: selected.output_tokens,
    num_model_requests: selected.num_model_requests,
  },
  reviewed_price_snapshot: {
    input_microusd_per_million_tokens: INPUT_MICROUSD_PER_MILLION,
    cached_input_microusd_per_million_tokens: CACHED_INPUT_MICROUSD_PER_MILLION,
    output_microusd_per_million_tokens: OUTPUT_MICROUSD_PER_MILLION,
  },
  source_export: usageExport,
};
await mkdir(dirname(resolvedOutputPath), { recursive: true, mode: 0o700 });
await writeFile(resolvedOutputPath, `${JSON.stringify(importArtifact, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
await chmod(resolvedOutputPath, 0o600);
console.log(JSON.stringify({
  exported: true,
  target_environment: "staging",
  period_start: importArtifact.period_start,
  period_end: importArtifact.period_end,
  provider: importArtifact.provider,
  model: selected.model,
  request_count: selected.num_model_requests,
  billed_microusd: importArtifact.billed_microusd,
  source_export_sha256: exportSha256,
  output_path: resolvedOutputPath,
}, null, 2));
