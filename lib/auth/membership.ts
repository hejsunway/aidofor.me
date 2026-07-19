import { createClient } from "@/lib/supabase/server";

// Aido shares auth.users with TutorPakar, but product access remains in an
// Aido-owned table. The upsert can be retried safely after signup or login.
export async function ensureAidoMembership(userId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("aido_product_memberships").upsert(
    {
      user_id: userId,
      status: "active",
      role: "student",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id", ignoreDuplicates: true },
  );

  if (error) throw new Error("Your Aido workspace could not be prepared.");
}
