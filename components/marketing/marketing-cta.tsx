import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";

type MarketingCtaProps = {
  eyebrow?: string;
  title?: string;
  description?: string;
};

export function MarketingCta({
  eyebrow = "Start with the assignment you actually have",
  title = "Bring the brief. Build work you can defend.",
  description = "Research with evidence. Write in your voice.",
}: MarketingCtaProps) {
  return (
    <section className="final-section">
      <div className="container final-card">
        <div className="final-orb" aria-hidden="true"><span /></div>
        <span className="kicker">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{description}</p>
        <div>
          <Link className="button button--primary button--large" href="/signup">
            Start a project <ArrowUpRight size={18} aria-hidden="true" />
          </Link>
          <Link className="text-link" href="/how-it-works">
            See how Aido works <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
