import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CircleCheck,
  ClipboardCheck,
  FileSearch,
  FileText,
  ListTree,
  MessageSquareMore,
  Scale,
} from "lucide-react";
import { MarketingCta } from "@/components/marketing/marketing-cta";
import { MarketingShell } from "@/components/marketing/marketing-shell";

export const metadata: Metadata = {
  title: "From assignment brief to rubric-mapped outline",
  description: "Extract, verify, and map assignment requirements before drafting. AidoFor.me turns briefs and rubrics into an approved research and writing plan.",
};

export default function BriefToOutlinePage() {
  return (
    <MarketingShell>
      <section className="marketing-page-hero">
        <div className="page-hero-glow" aria-hidden="true" />
        <div className="container page-hero-grid">
          <div className="page-hero-copy"><span className="page-kicker">Aido&apos;s assignment-first advantage</span><h1>Know what earns the marks<br /><span>before spending the words.</span></h1><p>Aido reads the brief and rubric together, turns them into an editable requirement matrix, surfaces conflicts, and maps every confirmed criterion into the outline.</p><div className="hero-actions"><Link className="button button--primary button--large" href="/signup">Analyze your assignment <ArrowRight size={18} /></Link><a className="button button--secondary button--large" href="#requirement-matrix">See the requirement matrix</a></div></div>
          <div className="requirements-hero-visual"><div className="requirements-files"><span><FileText size={17} /><b>Assignment brief.pdf</b><small>8 pages</small></span><span><Scale size={17} /><b>Rubric.pdf</b><small>2 pages</small></span></div><div className="requirements-summary"><div><small>REQUIREMENTS FOUND</small><b>8</b></div><div><small>NEEDS REVIEW</small><b>1</b></div><div><small>RUBRIC COVERAGE</small><b>75%</b></div></div><div className="requirements-example"><span><ClipboardCheck size={17} /></span><div><b>Critically compare two leadership theories</b><small>Brief p. 2 · Analysis · 30% of rubric</small></div><em><CircleCheck size={14} />Confirmed</em></div><div className="requirements-warning"><AlertTriangle size={17} /><div><b>Conflicting word counts</b><small>Brief: 2,000 words · Rubric: 2,500 words</small></div></div></div>
        </div>
      </section>

      <section className="section requirement-story-section" id="requirement-matrix"><div className="container"><div className="center-section-heading"><span className="kicker">The brief becomes structured project data</span><h2>No critical instruction should live only inside a PDF.</h2><p>Every extracted item stays editable, anchored to its source, and visible through research, outlining, drafting, and review.</p></div><div className="requirement-feature-grid"><article><span><FileSearch size={22} /></span><h3>Extract the academic move</h3><p>Identify whether the student must analyze, compare, evaluate, apply, synthesize, recommend, or propose—not merely discuss a topic.</p><div className="feature-chip-row"><em>Critically compare</em><em>Evaluate limits</em><em>Apply to case</em></div></article><article><span><AlertTriangle size={22} /></span><h3>Surface uncertainty early</h3><p>Show conflicting documents, unreadable pages, ambiguous wording, and low-confidence extraction instead of quietly guessing.</p><div className="mini-alert"><AlertTriangle size={14} />Ask your lecturer which word count applies.</div></article><article><span><MessageSquareMore size={22} /></span><h3>Make confirmation collaborative</h3><p>Edit Aido&apos;s interpretation, add missing instructions, and acknowledge unresolved ambiguity before the project advances.</p><div className="mini-confirm"><CircleCheck size={15} /><span><b>6 items confirmed</b><small>2 still need your review</small></span></div></article></div></div></section>

      <section className="section outline-story-section"><div className="container outline-story-layout"><div className="outline-demo"><div className="outline-demo__head"><span>RUBRIC-MAPPED OUTLINE</span><b>2,000 words allocated</b></div><div className="outline-demo__row"><span>1</span><div><b>Introduction and position</b><small>Define · Establish thesis</small></div><em>200 words</em></div><div className="outline-demo__row is-focus"><span>2</span><div><b>Comparative analysis</b><small>Compare · Evaluate · 3 evidence cards</small></div><em>650 words</em></div><div className="outline-demo__rubric"><span>R1</span><div><b>Critical analysis · 30%</b><small>Mapped to section 2</small></div><Check size={16} /></div><div className="outline-demo__row"><span>3</span><div><b>Case application</b><small>Apply · Qualify · 2 evidence cards</small></div><em>550 words</em></div><div className="outline-demo__row"><span>4</span><div><b>Implications and conclusion</b><small>Synthesize · Recommend</small></div><em>600 words</em></div></div><div className="outline-story-copy"><span className="kicker">From criteria to structure</span><h2>Give every mark a planned home.</h2><p>Each outline section carries a purpose, analytical move, target claims, evidence links, requirement mappings, and word budget.</p><ul><li><CircleCheck size={16} />Flag criteria with no section</li><li><CircleCheck size={16} />Flag descriptive sections where analysis is required</li><li><CircleCheck size={16} />Show claims with weak or missing evidence</li><li><CircleCheck size={16} />Catch unrealistic word allocations</li></ul></div></div></section>

      <section className="section assignment-gate-section"><div className="container assignment-gate-card"><div><span className="kicker kicker--light">A mandatory confirmation gate</span><h2>Research begins after the task is understood.</h2><p>This gate is the core difference between an assignment workspace and a generic AI writer.</p></div><div className="assignment-gate-flow"><span><FileText size={18} />Brief and rubric</span><i /><span><ClipboardCheck size={18} />Student confirmation</span><i /><span><ListTree size={18} />Research and outline</span></div></div></section>
      <MarketingCta eyebrow="Understand the task before writing" title="Turn the brief into a plan you can inspect." description="Every requirement anchored. Every criterion mapped. Every important decision confirmed by you." />
    </MarketingShell>
  );
}
