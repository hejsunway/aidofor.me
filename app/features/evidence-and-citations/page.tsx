import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Ban,
  BookOpen,
  CircleCheck,
  ExternalLink,
  FileCheck2,
  Highlighter,
  Library,
  Link2,
  Quote,
  SearchCheck,
  ShieldCheck,
} from "lucide-react";
import { MarketingCta } from "@/components/marketing/marketing-cta";
import { MarketingShell } from "@/components/marketing/marketing-shell";

export const metadata: Metadata = {
  title: "Evidence cards and citation verification",
  description: "Keep academic claims connected to exact source passages, access levels, page locators, source metadata, and deterministic citations with AidoFor.me.",
};

export default function EvidenceAndCitationsPage() {
  return (
    <MarketingShell darkHeader>
      <section className="marketing-page-hero marketing-page-hero--dark evidence-page-hero">
        <div className="page-hero-glow" aria-hidden="true" />
        <div className="container page-hero-grid">
          <div className="page-hero-copy"><span className="page-kicker">Evidence before prose</span><h1>Open the source behind<br /><span>every important claim.</span></h1><p>Aido keeps bibliographic metadata, analyzed access level, exact passages, page locators, limitations, and student notes connected from research through final review.</p><div className="hero-actions"><Link className="button button--light button--large" href="/signup">Build an evidence-backed project <ArrowRight size={18} /></Link><a className="button button--ghost-light button--large" href="#evidence-cards">Inspect an evidence card</a></div></div>
          <div className="evidence-hero-card"><div className="evidence-hero-card__head"><div><span>EVIDENCE CARD</span><b>EC–014</b></div><span><ShieldCheck size={14} />Full text</span></div><div className="evidence-source"><small>JOURNAL ARTICLE · 2024</small><b>Leadership autonomy and performance across uncertain task environments</b><span>Journal of Organisational Studies · DOI verified</span></div><blockquote>“The relationship between leadership autonomy and team performance depended strongly on task uncertainty and institutional context.”</blockquote><div className="evidence-locator"><Highlighter size={15} /><span><b>Qualifies the planned claim</b><small>Page 14 · Results · paragraph 3</small></span></div><div className="evidence-approval"><CircleCheck size={16} />Approved by student <button type="button">Open passage <ExternalLink size={13} /></button></div></div>
        </div>
      </section>

      <section className="marketing-trust-bar marketing-trust-bar--dark"><div className="container"><span><CircleCheck size={15} />No citation without a source record</span><span><Quote size={15} />No quotation without exact text</span><span><Link2 size={15} />No material claim without inspectable support</span></div></section>

      <section className="section evidence-card-story" id="evidence-cards"><div className="container"><div className="section-heading section-heading--split"><div><span className="kicker">A source is more than a title</span><h2>Know what Aido actually had access to.</h2></div><p>Aido never implies that a full paper was read when only metadata or an abstract was available. Access level stays visible wherever the source is used.</p></div><div className="access-level-grid"><article><span className="access-level access-level--full">Full text</span><BookOpen size={23} /><h3>Passage-level evidence</h3><p>Exact text, stable location, source version, and contextual notes can support material claims.</p></article><article><span className="access-level access-level--abstract">Abstract only</span><FileCheck2 size={23} /><h3>Limited conclusions</h3><p>Use for high-level relevance and screening, never for exact quotations or detailed results.</p></article><article><span className="access-level access-level--meta">Metadata only</span><Library size={23} /><h3>Identity and discovery</h3><p>Confirm title, authors, venue, year, identifier, and access routes without pretending content was analyzed.</p></article></div></div></section>

      <section className="section claim-ledger-section"><div className="container claim-ledger-layout"><div className="claim-ledger-copy"><span className="kicker kicker--light">The claim-to-evidence ledger</span><h2>Agreement, conflict, and limits stay visible.</h2><p>Evidence is organized around planned claims and themes—not buried inside a folder of PDFs.</p><ul><li><CircleCheck size={16} />Supports the claim directly</li><li><CircleCheck size={16} />Contradicts the claim or finding</li><li><CircleCheck size={16} />Qualifies the context or strength</li><li><CircleCheck size={16} />Provides background only</li></ul></div><div className="claim-ledger"><div className="claim-ledger__claim"><span>PLANNED CLAIM</span><b>Leadership autonomy improves team performance.</b><small>Current status: needs qualification</small></div><div className="claim-edge is-support"><span>SUPPORTS</span><div><b>Healthcare teams</b><small>Page 8 · full text</small></div></div><div className="claim-edge is-qualify"><span>QUALIFIES</span><div><b>Depends on task uncertainty</b><small>Page 14 · full text</small></div></div><div className="claim-edge is-conflict"><span>CONTRADICTS</span><div><b>High-risk operations study</b><small>Abstract-level evidence</small></div></div></div></div></section>

      <section className="section citation-pipeline-section"><div className="container"><div className="center-section-heading"><span className="kicker">Citation integrity pipeline</span><h2>A formatted reference is the final step—not the first.</h2><p>Bibliographies are rendered from verified structured data, while support is checked against the passage connected to the claim.</p></div><div className="citation-pipeline"><article><span>01</span><SearchCheck size={21} /><h3>Resolve the source</h3><p>Match DOI or stable identifier and normalize metadata.</p></article><i /><article><span>02</span><Highlighter size={21} /><h3>Anchor the passage</h3><p>Save exact text, locator, and immutable source version.</p></article><i /><article><span>03</span><Link2 size={21} /><h3>Connect the claim</h3><p>Record whether evidence supports, qualifies, or contradicts.</p></article><i /><article><span>04</span><FileCheck2 size={21} /><h3>Render and verify</h3><p>Format deterministically and recheck before export.</p></article></div></div></section>

      <section className="section export-blockers-section"><div className="container export-blockers-layout"><div><span className="kicker kicker--light">Trust checks that can stop export</span><h2>Critical problems are shown, not smoothed over.</h2><p>Aido does not hide unsupported work behind a single score.</p></div><div><span><Ban size={17} />Nonexistent or unresolved reference</span><span><Ban size={17} />Quotation without exact retrieved text and locator</span><span><Ban size={17} />Citation attached to a passage that does not support the claim</span><span><Ban size={17} />Invented finding, data, case fact, or personal experience</span></div></div></section>
      <MarketingCta eyebrow="Research that stays inspectable" title="Build claims from evidence you have approved." description="Real sources. Exact passages. Visible limits. Citations you can open and check." />
    </MarketingShell>
  );
}
