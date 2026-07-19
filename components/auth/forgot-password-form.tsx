// filepath: components/auth/forgot-password-form.tsx
"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { requestRecoveryAction, type ForgotState } from "@/lib/auth/actions";

export function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState<ForgotState, FormData>(
    requestRecoveryAction,
    null,
  );

  if (state?.sent && !state.error) {
    return (
      <div className="auth-form">
        <div className="auth-banner auth-banner--success" role="status">
          If an account exists for <b>{state.email}</b>, a reset link is on its way.
          The new password will also be used for TutorPakar.
        </div>
        <Link className="button button--secondary button--full" href="/login">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form className="auth-form" action={formAction} noValidate>
      {state?.error ? (
        <div className="auth-banner auth-banner--error" role="alert">
          {state.error}
        </div>
      ) : null}

      <label className="auth-field">
        <span>Email address</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          defaultValue={state?.email ?? ""}
          placeholder="you@university.edu"
          disabled={isPending}
        />
      </label>

      <button
        className="button button--primary button--full"
        type="submit"
        disabled={isPending}
      >
        {isPending ? (
          <>
            <Loader2 size={16} className="spin" /> Sending reset link…
          </>
        ) : (
          "Email me a reset link"
        )}
      </button>

      <p className="auth-switch">
        Remembered it? <Link href="/login">Back to sign in</Link>
      </p>
    </form>
  );
}