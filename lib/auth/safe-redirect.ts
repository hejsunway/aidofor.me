// filepath: lib/auth/safe-redirect.ts
// Open-redirect guard. Only allows relative internal paths starting with a
// single "/" (no protocol, no "//", no backslashes). Anything else is
// rejected and we fall back to a safe internal destination.

export function safeInternalPath(
  candidate: string | null | undefined,
  fallback: string,
): string {
  if (!candidate || typeof candidate !== "string") return fallback;
  // Reject protocol-relative URLs ("//evil.com"), backslashes, and anything
  // that doesn't begin with a single forward slash.
  if (!candidate.startsWith("/")) return fallback;
  if (candidate.startsWith("//")) return fallback;
  if (candidate.includes("\\")) return fallback;
  // Reject anything containing a scheme like "javascript:".
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) return fallback;
  // Reject control characters.
  if (/[\x00-\x1f]/.test(candidate)) return fallback;
  return candidate;
}

export function safeNextPath(
  candidate: string | null | undefined,
): string {
  return safeInternalPath(candidate, "/app");
}

export function safeCallbackPath(
  candidate: string | null | undefined,
): string {
  return safeInternalPath(candidate, "/login");
}