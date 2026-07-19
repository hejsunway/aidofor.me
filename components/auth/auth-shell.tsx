// filepath: components/auth/auth-shell.tsx
// Shared visual layout for the auth surfaces. Renders the marketing panel
// on the left and the supplied form on the right. Pure server component.
import Link from "next/link";
import { ArrowLeft, Check, Quote } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";

export type AuthMode = "login" | "signup" | "forgot" | "reset";

const COPY: Record<
  AuthMode,
  { kicker: string; heading: string; subheading: string; backHref: string }
> = {
  login: {
    kicker: "WELCOME BACK",
    heading: "Log in to your workspace",
    subheading:
      "Secure account access. Your TutorPakar password works here too.",
    backHref: "/",
  },
  signup: {
    kicker: "PRIVATE BETA",
    heading: "Create your Aido workspace",
    subheading:
      "One account, shared with TutorPakar. Use the same email you already use on tutorpakar.com.",
    backHref: "/",
  },
  forgot: {
    kicker: "RESET PASSWORD",
    heading: "Forgot your password?",
    subheading:
      "We'll email you a reset link. The new password updates your shared TutorPakar account too.",
    backHref: "/login",
  },
  reset: {
    kicker: "NEW PASSWORD",
    heading: "Choose a new password",
    subheading:
      "The new password updates your shared TutorPakar account too.",
    backHref: "/login",
  },
};

type AuthShellProps = {
  mode: AuthMode;
  children: React.ReactNode;
};

export function AuthShell({ mode, children }: AuthShellProps) {
  const copy = COPY[mode];
  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <BrandLogo inverse />
        <div className="auth-brand-copy">
          <span>A calmer way through academic work</span>
          <h1>{copy.heading}</h1>
          <p>{copy.subheading}</p>
        </div>
        <div className="auth-proof-card">
          <Quote size={20} />
          <p>
            “The brief is a contract. Aido helps you understand it before you
            spend hours writing.”
          </p>
          <span>Product principle 02</span>
        </div>
        <ul className="auth-benefits">
          <li><Check size={15} />Private projects</li>
          <li><Check size={15} />Verifiable sources</li>
          <li><Check size={15} />Student approval gates</li>
        </ul>
      </section>
      <section className="auth-form-panel">
        <Link className="auth-back" href={copy.backHref}>
          <ArrowLeft size={16} />Back to AidoFor.me
        </Link>
        <div className="auth-form-wrap">
          <span className="auth-kicker">{copy.kicker}</span>
          <h2>{copy.heading}</h2>
          <p>{copy.subheading}</p>
          {children}
        </div>
      </section>
    </main>
  );
}