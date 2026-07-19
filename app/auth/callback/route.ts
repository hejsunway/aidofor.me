// filepath: app/auth/callback/route.ts
// Handles Supabase email confirmation, OAuth, and PKCE password recovery
// return URLs. Exchanges the auth code for a session, ensures the
// AidoForMe membership row exists for the freshly authenticated user,
// then redirects to the requested destination.
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

function safeNextPath(value: string | null | undefined): string {
  if (!value) return "/app";
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /^[a-z][a-z0-9+.-]*:/i.test(value)
  ) {
    return "/app";
  }
  return value;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));
  // Some Supabase email templates still send hash-fragment tokens.
  // The browser client handles those automatically on the client side;
  // the server route only handles the PKCE `code` flow.

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      // Code exchange failed: bounce to login with a friendly error param.
      const loginUrl = new URL("/login", origin);
      loginUrl.searchParams.set("error", "exchange_failed");
      return NextResponse.redirect(loginUrl);
    }

    // Code exchange succeeded — we now have a fresh session. Create
    // the AidoForMe membership row if this is a new user, so subsequent
    // RLS-protected queries against `aido_*` tables work. This covers
    // both email/password and OAuth signups on aidofor.me.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      // Failure is non-fatal: the next server action will retry.
      await supabase
        .from("aido_product_memberships")
        .upsert(
          {
            user_id: user.id,
            status: "active",
            role: "student",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id", ignoreDuplicates: true },
        )
        .then(({ error: upsertError }) => {
          if (upsertError) {
            console.warn(
              "[aidofor-me] /auth/callback ensureMembership failed for",
              user.email ?? user.id,
              upsertError.message,
            );
          }
        });
    }

    return NextResponse.redirect(`${origin}${next}`);
  }

  // No code and no hash handling here — send users to /login.
  return NextResponse.redirect(`${origin}/login`);
}