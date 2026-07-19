// filepath: app/signup/page.tsx
import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignupForm } from "@/components/auth/signup-form";
import { safeInternalPath } from "@/lib/auth/safe-redirect";

export const metadata: Metadata = {
  title: "Create your workspace",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<{ next?: string; confirmed?: string; email?: string }>;

export default async function SignupPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const nextPath = safeInternalPath(params.next, "/app");

  return (
    <AuthShell mode="signup">
      {params.confirmed === "1" && params.email ? (
        <div className="auth-banner auth-banner--success" role="status">
          We sent a confirmation link to <b>{decodeURIComponent(params.email)}</b>.
          Open it on this device to finish creating your AidoFor.me workspace.
        </div>
      ) : null}
      <SignupForm nextPath={nextPath} />
    </AuthShell>
  );
}