import Link from "next/link";
import { ArrowUpRight, Menu } from "lucide-react";
import { BrandLogo } from "./brand-logo";

export function SiteHeader({ inverse = false }: { inverse?: boolean }) {
  return (
    <header className={inverse ? "site-header site-header--inverse" : "site-header"}>
      <div className="site-header__inner container">
        <BrandLogo inverse={inverse} />
        <nav className="site-nav" aria-label="Main navigation">
          <Link href="/how-it-works">How it works</Link>
          <Link href="/features/brief-to-outline">Brief to outline</Link>
          <Link href="/features/evidence-and-citations">Evidence</Link>
          <Link href="/academic-integrity">Academic integrity</Link>
        </nav>
        <div className="site-header__actions">
          <Link className="text-button" href="/login">Log in</Link>
          <Link className="button button--primary button--small" href="/signup">
            Start a project <ArrowUpRight aria-hidden="true" size={16} />
          </Link>
        </div>
        <details className="mobile-menu">
          <summary aria-label="Open navigation"><Menu aria-hidden="true" size={22} /></summary>
          <nav aria-label="Mobile navigation">
            <Link href="/how-it-works">How it works</Link>
            <Link href="/features/brief-to-outline">Brief to outline</Link>
            <Link href="/features/evidence-and-citations">Evidence and citations</Link>
            <Link href="/academic-integrity">Academic integrity</Link>
            <Link href="/login">Log in</Link>
            <Link className="button button--primary" href="/signup">Start a project</Link>
          </nav>
        </details>
      </div>
    </header>
  );
}
