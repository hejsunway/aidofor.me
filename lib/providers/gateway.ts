import "server-only";

import { createBillingAdminClient } from "@/lib/billing/admin";
import { asSafeBigInt, toSafeNumber } from "@/lib/billing/integer-math";
import {
  calculateCreditsFromRate,
  calculateProviderCostMicrousd,
  type TrustedWorkEstimate,
} from "@/lib/billing/quote";

type JsonObject = Record<string, unknown>;

type OpenAIUsage = {
  input_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens?: number;
};

type OpenAIResponse = JsonObject & {
  id?: string;
  status?: string;
  model?: string;
  output?: Array<JsonObject>;
  usage?: OpenAIUsage;
};

function outputText(response: OpenAIResponse): string {
  const parts: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content as Array<JsonObject>) {
      if (content.type === "output_text" && typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n");
}

function actualToolCounts(response: OpenAIResponse) {
  let toolCalls = 0;
  let searches = 0;
  for (const item of response.output ?? []) {
    if (item.type === "web_search_call") searches += 1;
    if (typeof item.type === "string" && item.type.endsWith("_call")) toolCalls += 1;
  }
  return { toolCalls, searches };
}

function errorCategory(status: number): string {
  if (status === 408 || status === 504) return "provider_timeout";
  if (status === 429) return "provider_rate_limit";
  if (status >= 500) return "provider_unavailable";
  return "provider_rejected_request";
}

async function releaseFailedReservation(
  reservationId: string,
  idempotencyKey: string,
  category: string,
) {
  const admin = createBillingAdminClient();
  const { error } = await admin.rpc("aido_release_reservation", {
    p_reservation_id: reservationId,
    p_terminal_status: "failed",
    p_failure_category: category,
    p_idempotency_key: `${idempotencyKey}:release`,
  });
  if (error) throw error;
}

export async function runMeteredOpenAIResponse<T>(input: {
  reservationId: string;
  callIdempotencyKey: string;
  usageIdempotencyKey: string;
  settlementIdempotencyKey: string;
  promptVersion: string;
  attempt: number;
  estimated: TrustedWorkEstimate;
  estimatedProviderCostMicrousd: number;
  instructions: string;
  modelInput: unknown;
  tools?: Array<JsonObject>;
  validate: (result: { response: OpenAIResponse; text: string }) => Promise<T>;
}): Promise<{ artifact: T; responseId: string; usage: TrustedWorkEstimate }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured on the server.");
  const admin = createBillingAdminClient();

  const { data: reservation, error: reservationError } = await admin
    .from("aido_usage_reservations")
    .select("*,aido_feature_rate_cards(*),aido_provider_routes(*,aido_provider_prices(*))")
    .eq("id", input.reservationId)
    .single();
  if (reservationError || !reservation) throw reservationError ?? new Error("Reservation not found.");
  const rate = reservation.aido_feature_rate_cards as JsonObject;
  const route = reservation.aido_provider_routes as JsonObject;
  const price = route.aido_provider_prices as JsonObject;
  if (!rate || !price) throw new Error("Reservation pricing snapshot is incomplete.");

  const { error: runningError } = await admin.rpc("aido_mark_reservation_running", {
    p_reservation_id: input.reservationId,
  });
  if (runningError) throw runningError;

  const authorizationExpiry = new Date(
    Date.now() + Math.min(Number(rate.timeout_ms) + 60_000, 30 * 60_000),
  ).toISOString();
  const { data: authorizationData, error: authorizationError } = await admin.rpc(
    "aido_authorize_provider_call",
    {
      p_reservation_id: input.reservationId,
      p_idempotency_key: input.callIdempotencyKey,
      p_attempt: input.attempt,
      p_estimated_cost_microusd: input.estimatedProviderCostMicrousd,
      p_estimated_input_tokens: input.estimated.inputTokens,
      p_estimated_output_tokens: input.estimated.outputTokens,
      p_estimated_tool_calls: input.estimated.toolCalls,
      p_estimated_search_calls: input.estimated.searches,
      p_estimated_pages: input.estimated.pages,
      p_expires_at: authorizationExpiry,
    },
  );
  if (authorizationError) throw authorizationError;
  const authorization = Array.isArray(authorizationData) ? authorizationData[0] : authorizationData;
  if (!authorization?.id || authorization.status !== "authorized") {
    throw new Error("Provider call was already finalized; retrieve the persisted job result instead of calling again.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(rate.timeout_ms));
  let response: Response;
  let payload: OpenAIResponse;
  const startedAt = Date.now();
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.callIdempotencyKey,
      },
      body: JSON.stringify({
        model: String(price.model),
        instructions: input.instructions,
        input: input.modelInput,
        tools: input.tools ?? [],
        max_output_tokens: input.estimated.outputTokens,
        store: false,
      }),
      signal: controller.signal,
    });
    payload = await response.json() as OpenAIResponse;
  } catch (error) {
    clearTimeout(timeout);
    const category = error instanceof Error && error.name === "AbortError"
      ? "provider_timeout"
      : "provider_network_error";
    await releaseFailedReservation(input.reservationId, input.callIdempotencyKey, category);
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const usage = payload.usage;
  const counts = actualToolCounts(payload);
  const actual: TrustedWorkEstimate & { cachedInputTokens: number } = {
    inputTokens: usage?.input_tokens ?? 0,
    cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    pages: input.estimated.pages,
    sources: input.estimated.sources,
    toolCalls: counts.toolCalls,
    searches: counts.searches,
  };
  const actualProviderCost = calculateProviderCostMicrousd(price, actual);
  const succeeded = response.ok && payload.status === "completed";
  const failureCategory = succeeded ? null : errorCategory(response.status);

  const { error: usageError } = await admin.rpc("aido_record_usage_event", {
    p_authorization_id: authorization.id,
    p_idempotency_key: input.usageIdempotencyKey,
    p_provider_request_id: payload.id ?? null,
    p_prompt_version: input.promptVersion,
    p_input_tokens: actual.inputTokens,
    p_cached_input_tokens: actual.cachedInputTokens,
    p_output_tokens: actual.outputTokens,
    p_tool_calls: actual.toolCalls,
    p_search_calls: actual.searches,
    p_processed_pages: actual.pages,
    p_latency_ms: Date.now() - startedAt,
    p_provider_cost_microusd: toSafeNumber(actualProviderCost, "actual provider cost"),
    p_outcome: succeeded ? "succeeded" : "failed",
    p_billable_to_student: succeeded,
    p_failure_category: failureCategory,
  });
  if (usageError) throw usageError;
  if (!succeeded) {
    await releaseFailedReservation(input.reservationId, input.callIdempotencyKey, failureCategory!);
    throw new Error(`OpenAI response failed: ${failureCategory}.`);
  }

  let artifact: T;
  try {
    artifact = await input.validate({ response: payload, text: outputText(payload) });
  } catch (error) {
    await releaseFailedReservation(input.reservationId, input.callIdempotencyKey, "output_validation_failed");
    throw error;
  }

  const capture = calculateCreditsFromRate(rate, actual);
  const maximum = asSafeBigInt(reservation.maximum_credits, "reservation maximum");
  if (capture > maximum) {
    await releaseFailedReservation(input.reservationId, input.callIdempotencyKey, "actual_charge_exceeded_reservation");
    throw new Error("Actual credit charge exceeded the reserved maximum.");
  }
  const { error: settleError } = await admin.rpc("aido_settle_reservation", {
    p_reservation_id: input.reservationId,
    p_capture_credits: toSafeNumber(capture, "captured credits"),
    p_idempotency_key: input.settlementIdempotencyKey,
  });
  if (settleError) throw settleError;

  return {
    artifact,
    responseId: String(payload.id),
    usage: actual,
  };
}
