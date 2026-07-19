// filepath: lib/auth/error-messages.ts
// Map Supabase Auth error strings to user-safe copy. Never echo raw error
// messages from the Supabase SDK because they can leak whether an account
// exists, whether the email is verified, or rate-limit details.

const GENERIC_INVALID = "Email or password is incorrect.";
const GENERIC_NETWORK =
  "We couldn't reach the authentication service. Please try again.";
const GENERIC_RATE_LIMIT =
  "Too many attempts. Please wait a moment and try again.";

export function friendlyAuthError(error: unknown): string {
  if (!error || typeof error !== "object") return GENERIC_INVALID;
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message.toLowerCase()
      : "";
  const status =
    "status" in error && typeof error.status === "number"
      ? error.status
      : null;

  if (
    message.includes("invalid login credentials") ||
    message.includes("invalid email or password")
  ) {
    return GENERIC_INVALID;
  }
  if (message.includes("email not confirmed")) {
    return "Please confirm your email before signing in. Check your inbox for the verification link.";
  }
  if (message.includes("user already registered")) {
    return "An account already exists for this email. Try signing in or reset your password.";
  }
  if (message.includes("rate limit") || status === 429) {
    return GENERIC_RATE_LIMIT;
  }
  if (
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("timeout")
  ) {
    return GENERIC_NETWORK;
  }
  if (message.includes("password") && message.includes("at least")) {
    return (error as { message: string }).message;
  }
  return GENERIC_INVALID;
}

export function friendlyRecoveryError(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "We couldn't send the reset email. Please try again.";
  }
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message.toLowerCase()
      : "";
  if (message.includes("rate limit") || message.includes("too many")) {
    return GENERIC_RATE_LIMIT;
  }
  if (message.includes("network") || message.includes("fetch")) {
    return GENERIC_NETWORK;
  }
  return "If an account exists for that email, a reset link is on its way.";
}

export function friendlyResetError(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "We couldn't update your password. The reset link may have expired — request a new one.";
  }
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message.toLowerCase()
      : "";
  if (message.includes("expired") || message.includes("invalid")) {
    return "This reset link has expired or already been used. Request a new one.";
  }
  if (message.includes("rate limit")) return GENERIC_RATE_LIMIT;
  if (message.includes("password") && message.includes("at least")) {
    return (error as { message: string }).message;
  }
  return "We couldn't update your password. The reset link may have expired — request a new one.";
}