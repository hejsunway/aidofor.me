// filepath: lib/auth/actions.ts
// Server actions for the AidoForMe auth surface. All actions validate the
// `next` parameter against open-redirect attacks and emit cookie-scoped
// sessions only — never trust getSession() for authorization.
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth/safe-redirect";
import {
  friendlyAuthError,
  friendlyRecoveryError,
  friendlyResetError,
} from "@/lib/auth/error-messages";
import { ensureAidoMembership } from "@/lib/auth/membership";

function siteOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return "https://aidofor.me";
}

function callbackUrl(path: string): string {
  return `${siteOrigin()}${path}`;
}

// Lazy membership upsert — runs after signup or first login so an
// AidoForMe row exists whenever an AidoForMe session is established.
// We deliberately avoid creating a second auth.users trigger so we don't
// touch TutorPakar's handle_new_user(). This is race-safe: the upsert
// only writes a row for the current authenticated user (auth.uid()).
async function ensureMembership(
  userId: string,
  email: string | null | undefined,
): Promise<void> {
  try {
    await ensureAidoMembership(userId);
  } catch (error) {
    // Don't block auth on this — the next login will retry. Log quietly.
    console.warn(
      "[aidofor-me] ensureMembership failed for",
      email ?? userId,
      error instanceof Error ? error.message : "Unknown membership error",
    );
  }
}

// ----- Login ------------------------------------------------------------

export type LoginState = { error?: string; email?: string } | null;

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(String(formData.get("next") ?? ""));

  if (!email || !password) {
    return { error: "Enter your email and password to continue.", email };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) {
    return { error: friendlyAuthError(error), email };
  }

  // Make sure the user has an AidoForMe row. We do not block redirect on
  // failure — the membership will be created on the next request.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await ensureMembership(user.id, user.email);
  }

  revalidatePath("/", "layout");
  redirect(next);
}

// ----- Signup -----------------------------------------------------------

export type SignupState = { error?: string; email?: string } | null;

export async function signupAction(
  _prev: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const acceptTerms = formData.get("acceptTerms") === "on";

  if (!email || !password) {
    return { error: "Enter an email and password to create your workspace.", email };
  }
  if (password.length < 8) {
    return {
      error: "Choose a password with at least 8 characters.",
      email,
    };
  }
  if (password !== confirm) {
    return { error: "The two passwords do not match.", email };
  }
  if (!acceptTerms) {
    return {
      error: "Please confirm you'll use AidoForMe in line with your course rules.",
      email,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Force the confirmation email to bounce back into AidoForMe, not the
      // shared Site URL (which TutorPakar owns).
      emailRedirectTo: callbackUrl("/auth/callback?next=/app"),
    },
  });
  if (error) {
    return { error: friendlyAuthError(error), email };
  }

  // If email confirmation is disabled, signUp returns an active session and
  // we can create the membership and redirect immediately. Otherwise we
  // surface a "check your inbox" confirmation state via a URL param so the
  // form can show success copy.
  if (data.session && data.user) {
    await ensureMembership(data.user.id, data.user.email);
    revalidatePath("/", "layout");
    redirect("/app");
  }

  redirect(
    `/login?confirmed=1&email=${encodeURIComponent(email)}`,
  );
}

// ----- Forgot password --------------------------------------------------

export type ForgotState = { sent?: boolean; email?: string; error?: string } | null;

export async function requestRecoveryAction(
  _prev: ForgotState,
  formData: FormData,
): Promise<ForgotState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) {
    return { error: "Enter the email address on your account." };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: callbackUrl("/auth/callback?next=/reset-password"),
  });
  // We always reply with the same neutral copy regardless of whether the
  // email exists, so we don't leak which addresses have accounts.
  return {
    sent: true,
    email,
    error: error ? friendlyRecoveryError(error) : undefined,
  };
}

// ----- Reset password (called from /reset-password after PKCE) ---------

export type ResetState = { error?: string } | null;

export async function resetPasswordAction(
  _prev: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) {
    return { error: "Choose a password with at least 8 characters." };
  }
  if (password !== confirm) {
    return { error: "The two passwords do not match." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: friendlyResetError(error) };
  }
  revalidatePath("/", "layout");
  redirect("/login?reset=1");
}

// ----- Logout (scope: local — ends only this session) -------------------

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  // scope: 'local' ends just the session in the current browser tab, so
  // other TutorPakar devices, the user's mobile session, and other
  // products sharing auth.users are NOT signed out.
  await supabase.auth.signOut({ scope: "local" });
  revalidatePath("/", "layout");
  redirect("/login");
}

// ----- Re-exported helpers used by server components -------------------

export async function requireAuthId(): Promise<{ id: string; email: string } | null> {
  const supabase = await createClient();
  // getUser() is authoritative (network round-trip) — never trust
  // getSession() for server-side authorization.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { id: user.id, email: user.email ?? "" };
}

// Best-effort guard for protected layouts: if no user, redirect to /login.
export async function requireAuthOrRedirect(
  next: string,
): Promise<{ id: string; email: string }> {
  const auth = await requireAuthId();
  if (!auth) {
    redirect(`/login?next=${encodeURIComponent(safeNextPath(next))}`);
  }
  return auth;
}
