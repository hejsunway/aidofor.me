import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";

export function MarketingFooter() {
  return (
    <footer className="site-footer">
      <div className="container footer-main">
        <div>
          <BrandLogo inverse />
          <p>Research with evidence.<br />Write in your voice.</p>
        </div>
        <nav aria-label="Product links">
          <span>Product</span>
          <Link href="/how-it-works">How it works</Link>
          <Link href="/features/brief-to-outline">Brief to outline</Link>
          <Link href="/features/evidence-and-citations">Evidence and citations</Link>
          <Link href="/academic-integrity">Academic integrity</Link>
        </nav>
        <nav aria-label="Account links">
          <span>Account</span>
          <Link href="/login">Log in</Link>
          <Link href="/signup">Start a project</Link>
          <Link href="/app">Your workspace</Link>
        </nav>
      </div>
      <div className="container footer-bottom">
        <span>© 2026 AidoFor.me</span>
        <span>A TutorPakar product</span>
        <span>Built for student-owned work.</span>
      </div>
    </footer>
  );
}
