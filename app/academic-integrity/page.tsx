import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Ban,
  Check,
  CircleCheck,
  Eye,
  FileClock,
  Fingerprint,
  LockKeyhole,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { MarketingCta } from "@/components/marketing/marketing-cta";
import { MarketingShell } from "@/components/marketing/marketing-shell";

export const metadata: Metadata = {
  title: "Academic integrity",
  description: "See how AidoFor.me adapts to assignment AI policies, preserves student agency, verifies evidence, and blocks fabricated or deceptive academic work.",
};

const modes = [
  { name: "No AI permitted", allowed: "Manual planning, source library, deadlines, and citation formatting from entered metadata.", blocked: "AI analysis, synthesis, outlining, rewriting, and submission-ready prose." },
  { name: "Planning only", allowed: "Brief explanation, research questions, keywords, source discovery, outline suggestions, and feedback.", blocked: "Submission-ready paragraph drafting or rewriting beyond the permitted rules." },
  { name: "Assistive writing", allowed: "Research, evidence mapping, grounded section suggestions, editing, citation checks, and disclosure.", blocked: "One-click papers, invented evidence, concealed assistance, and automatic submission." },
  { name: "Open or required AI", allowed: "The full guided workflow with process export and evaluation against any AI-use criteria.", blocked: "Fabricated evidence, data, experience, or unreviewed autonomous submission." },
  { name: "Unknown", allowed: "Brief analysis, policy checklist, and manual research organization.", blocked: "Draft generation until the student confirms what the assignment permits." },
];

export default function AcademicIntegrityPage() {
  return (
    <MarketingShell darkHeader>
      <section className="marketing-page-hero marketing-page-hero--dark">
        <div className="page-hero-glow" aria-hidden="true" />
        <div className="container page-hero-grid">
          <div className="page-hero-copy"><span className="page-kicker">Academic integrity, built into the workflow</span><h1>AI that works<br /><span>within your rules.</span></h1><p>Your institution and instructor decide what is permitted. Aido makes that policy a project setting that controls the available help—not a disclaimer hidden in the footer.</p><div className="hero-actions"><Link className="button button--light button--large" href="/signup">Set up a responsible project <ArrowRight size={18} /></Link><a className="button button--ghost-light button--large" href="#policy-modes">Compare policy modes</a></div></div>
          <div className="policy-hero-card"><div className="policy-hero-card__head"><ShieldCheck size={23} /><div><span>PROJECT POLICY</span><b>Assistive writing</b></div><small>Confirmed by student</small></div><div className="policy-capability is-allowed"><span><Check size={15} />AVAILABLE</span><p>Research, evidence cards, section suggestions, minimal-change editing, citation verification.</p></div><div className="policy-capability is-blocked"><span><Ban size={15} />ALWAYS BLOCKED</span><p>Invented sources or data, detector bypass, false disclosure, automatic submission.</p></div><div className="policy-student"><div className="avatar">Y</div><div><b>The student remains responsible</b><small>Read, verify, revise, approve, and submit personally.</small></div></div></div>
        </div>
      </section>

      <section className="section policy-modes-section" id="policy-modes"><div className="container"><div className="center-section-heading"><span className="kicker">One project, one confirmed mode</span><h2>Choose the level of help the assignment allows.</h2><p>If the rule is unclear, Aido defaults conservatively and keeps drafting locked.</p></div><div className="policy-mode-list">{modes.map((mode, index) => <article key={mode.name}><div className="policy-mode-title"><span>{String(index + 1).padStart(2, "0")}</span><h3>{mode.name}</h3>{mode.name === "Unknown" && <em>Safest default</em>}</div><div><span className="allowed-label"><Check size={14} />Allowed</span><p>{mode.allowed}</p></div><div><span className="blocked-label"><Ban size={14} />Blocked</span><p>{mode.blocked}</p></div></article>)}</div></div></section>

      <section className="section integrity-principles-section"><div className="container"><div className="section-heading section-heading--split"><div><span className="kicker">Trust comes from the process</span><h2>Show the work behind the work.</h2></div><p>Aido focuses on verifiable decisions and authorship history instead of pretending a detector can decide who wrote a sentence.</p></div><div className="integrity-principles-grid"><article><Eye size={22} /><h3>Inspectable evidence</h3><p>Material claims open back to exact source passages, locators, access levels, and versions.</p></article><article><Fingerprint size={22} /><h3>Visible authorship</h3><p>Typed, pasted, suggested, accepted, rejected, and edited actions form a readable history.</p></article><article><UserCheck size={22} /><h3>Explicit approval</h3><p>Suggestions never silently overwrite student work or advance through a high-impact gate.</p></article><article><FileClock size={22} /><h3>Honest disclosure</h3><p>The AI-use acknowledgement is based on logged actions and remains editable by the student.</p></article><article><LockKeyhole size={22} /><h3>Private by default</h3><p>Assignment files and derived data stay project-scoped and are not training material by default.</p></article><article><Ban size={22} /><h3>No concealment tools</h3><p>No humanizer, undetectable score, fabricated references, invented experience, or false declaration.</p></article></div></div></section>

      <section className="section hard-boundaries-section"><div className="container hard-boundaries-layout"><div><span className="kicker kicker--light">Boundaries that do not change</span><h2>Some requests are blocked in every mode.</h2><p>When a request crosses the line, Aido redirects the student to legitimate research planning, explanation, evidence organization, or revision coaching.</p></div><ul><li><CircleCheck size={17} />No fabricated survey participants, interviews, results, case facts, quotations, or references</li><li><CircleCheck size={17} />No invented personal reflection or lived experience</li><li><CircleCheck size={17} />No impersonation, assignment selling, or automatic LMS submission</li><li><CircleCheck size={17} />No detector bypass, humanization, or misleading originality guarantees</li><li><CircleCheck size={17} />No removal of citations while retaining borrowed ideas</li></ul></div></section>
      <MarketingCta eyebrow="Use AI without losing authorship" title="Keep the help visible. Keep the decisions yours." description="Aido supports responsible work that a student can explain, verify, and defend." />
    </MarketingShell>
  );
}
