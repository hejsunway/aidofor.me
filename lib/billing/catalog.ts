import "server-only";

import { createBillingAdminClient } from "@/lib/billing/admin";

export async function listActiveCreditProducts() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return [];
  const now = new Date().toISOString();
  const { data, error } = await createBillingAdminClient()
    .from("aido_credit_products")
    .select("id,product_key,kind,amount_sen,credit_grant,expires_after_days,effective_from")
    .in("kind", ["topup", "subscription"])
    .lte("effective_from", now)
    .or(`effective_to.is.null,effective_to.gt.${now}`)
    .order("amount_sen", { ascending: true });
  if (error && ["42P01", "PGRST205"].includes(error.code)) return [];
  if (error) throw error;
  return data ?? [];
}
