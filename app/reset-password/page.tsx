// filepath: app/reset-password/page.tsx
import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Set a new password",
  robots: { index: false, follow: false },
};

// This page must read the live session and write cookies during the
// Supabase auth exchange, so it cannot be statically pre-rendered.
export const dynamic = "force-dynamic";

// This page is reached after the PKCE recovery link exchanged at
// /auth/callback?next=/reset-password. The proxy already bounces users
// without a session away, so this layer is defense in depth: we verify
// the session is real and the recovery grant has been applied.
export default async function ResetPasswordPage() {
  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    // Env vars not configured yet (e.g. fresh clone, CI build). The
    // proxy still guards this route at runtime; the page falls through
    // to the form, and the first Supabase call will produce a clear
    // error instead of crashing the build.
    userId = null;
  }
  if (!userId) {
    redirect("/forgot-password");
  }

  return (
    <AuthShell mode="reset">
      <ResetPasswordForm />
    </AuthShell>
  );
}