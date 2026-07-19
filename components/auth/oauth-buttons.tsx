// filepath: components/auth/oauth-buttons.tsx
// "Continue with Google" button. Lives on /login and /signup so existing
// TutorPakar users who signed up with Google can authenticate the same
// way here. The same Supabase project is used for both products, so the
// resulting auth.users row is shared.
"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { safeInternalPath } from "@/lib/auth/safe-redirect";

type Provider = "google";

type OAuthButtonsProps = {
  nextPath: string;
};

const ICONS: Record<Provider, React.ReactNode> = {
  google: (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C12.955 4 4 12.955 4 24s8.955 20 20 20s20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571c.001-.001.002-.001.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  ),
};

export function OAuthButtons({ nextPath }: OAuthButtonsProps) {
  const [pending, setPending] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signInWith(provider: Provider) {
    setPending(provider);
    setError(null);
    try {
      const supabase = createClient();
      const next = safeInternalPath(nextPath, "/app");
      // Always pin the OAuth bounce URL to the canonical apex
      // (aidofor.me), never window.location.origin. This guarantees
      // the redirect_uri registered with Supabase matches the URL the
      // browser actually returns to, even if the user landed on the
      // www subdomain or if Vercel's domain edge rewrites hosts.
      const canonicalOrigin =
        process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
        window.location.origin;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${canonicalOrigin}/auth/callback?next=${encodeURIComponent(next)}`,
          // Always show the Google account picker so a TutorPakar user
          // with multiple Google identities can pick the right one.
          queryParams: { prompt: "select_account" },
        },
      });
      if (oauthError) {
        setPending(null);
        setError("We couldn't start the sign-in. Please try again.");
      }
      // On success Supabase redirects the browser to Google's consent
      // screen — we never get past the `await` in the happy path.
    } catch {
      setPending(null);
      setError("We couldn't start the sign-in. Please try again.");
    }
  }

  return (
    <div className="auth-oauth">
      <button
        type="button"
        className="auth-oauth__btn"
        disabled={pending !== null}
        onClick={() => signInWith("google")}
        aria-label="Continue with Google"
      >
        {pending === "google" ? (
          <Loader2 size={17} className="spin" />
        ) : (
          ICONS.google
        )}
        <span>Continue with Google</span>
      </button>

      {error ? (
        <div className="auth-banner auth-banner--error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="auth-oauth__divider" role="separator" aria-label="or sign in with email">
        <span>or</span>
      </div>
    </div>
  );
}