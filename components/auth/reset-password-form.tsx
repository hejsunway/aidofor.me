// filepath: components/auth/reset-password-form.tsx
"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { PasswordInput } from "@/components/auth/password-input";
import { resetPasswordAction, type ResetState } from "@/lib/auth/actions";

export function ResetPasswordForm() {
  const [state, formAction, isPending] = useActionState<ResetState, FormData>(
    resetPasswordAction,
    null,
  );

  return (
    <form className="auth-form" action={formAction} noValidate>
      {state?.error ? (
        <div className="auth-banner auth-banner--error" role="alert">
          {state.error}
        </div>
      ) : null}

      <PasswordInput
        label="New password"
        name="password"
        autoComplete="new-password"
        required
        minLength={8}
        placeholder="At least 8 characters"
        disabled={isPending}
        hint="Use 8+ characters with letters and numbers."
      />

      <PasswordInput
        label="Confirm new password"
        name="confirm"
        autoComplete="new-password"
        required
        minLength={8}
        placeholder="Repeat your password"
        disabled={isPending}
      />

      <button
        className="button button--primary button--full"
        type="submit"
        disabled={isPending}
      >
        {isPending ? (
          <>
            <Loader2 size={16} className="spin" /> Updating password…
          </>
        ) : (
          "Update password"
        )}
      </button>

      <p className="auth-switch">
        Need a fresh link? <Link href="/forgot-password">Send a new reset email</Link>
      </p>
    </form>
  );
}