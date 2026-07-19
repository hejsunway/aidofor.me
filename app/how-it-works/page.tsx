import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  Check,
  CircleCheck,
  ClipboardCheck,
  Download,
  FileSearch,
  FileText,
  Highlighter,
  Library,
  ListTree,
  PenLine,
  SearchCheck,
  ShieldCheck,
} from "lucide-react";
import { MarketingCta } from "@/components/marketing/marketing-cta";
import { MarketingShell } from "@/components/marketing/marketing-shell";

export const metadata: Metadata = {
  title: "How it works",
  description: "Follow AidoFor.me from assignment brief and policy confirmation through research, evidence, rubric-mapped planning, verified writing, and export.",
};

const stages = [
  { number: "01", icon: FileText, title: "Add the brief, rubric, and policy", text: "Upload the documents that define the work. Aido keeps page and section anchors so extracted requirements can point back to the original wording.", object: "Private project files" },
  { number: "02", icon: ClipboardCheck, title: "Confirm every requirement", text: "Review command verbs, deliverables, word limits, required theories, source rules, rubric weights, and ambiguities. Correct Aido before research begins.", object: "Approved requirement matrix" },
  { number: "03", icon: FileSearch, title: "Approve the research plan", text: "Turn the confirmed task into a main question, subquestions, search terms, source-type requirements, filters, and evidence targets.", object: "Editable search plan" },
  { number: "04", icon: SearchCheck, title: "Find and screen real sources", text: "Discover academic metadata and legal access routes, or upload sources you are entitled to use. Include, exclude, or mark each source as maybe.", object: "Screened source library" },
  { number: "05", icon: Highlighter, title: "Save inspectable evidence", text: "Keep exact supporting passages with locators, access level, context, limitations, relationships to planned claims, and your own synthesis notes.", object: "Approved evidence cards" },
  { number: "06", icon: ListTree, title: "Map the rubric to the outline", text: "Give every criterion a planned section, analytical move, word budget, evidence target, and visible gap before drafting begins.", object: "Rubric-mapped outline" },
  { number: "07", icon: PenLine, title: "Write one section at a time", text: "Keep the active section's requirements, claims, evidence, and word budget in view. Suggestions remain reversible and factual claims retain evidence links.", object: "Student-reviewed draft" },
  { number: "08", icon: BookOpenCheck, title: "Verify, revise, and export", text: "Resolve separate requirement, argument, evidence, citation, synthesis, attribution, and defensibility issues before generating the final files.", object: "Verified export package" },
];

export default function HowItWorksPage() {
  return (
    <MarketingShell>
      <section className="marketing-page-hero">
        <div className="page-hero-glow" aria-hidden="true" />
        <div className="container page-hero-grid">
          <div className="page-hero-copy">
            <span className="page-kicker">A visible academic workflow</span>
            <h1>One assignment.<br /><span>Eight reviewable stages.</span></h1>
            <p>Aido turns useful AI help into structured objects you can inspect: requirements, search plans, sources, evidence cards, outline sections, review issues, and exports.</p>
            <div className="hero-actions"><Link className="button button--primary button--large" href="/signup">Start with your brief <ArrowRight size={18} /></Link><a className="button button--secondary button--large" href="#stages">Explore every stage</a></div>
          </div>
          <div className="journey-visual" aria-label="The eight stages of an Aido project">
            <div className="journey-visual__top"><span>Leadership analysis</span><span><ShieldCheck size={13} /> Assistive writing</span></div>
            <div className="journey-progress"><span>Project progress</span><b>2 of 8 confirmed</b><i><em /></i></div>
            <div className="journey-list">{stages.map(({ number, title }, index) => <div className={index === 1 ? "is-current" : index === 0 ? "is-complete" : ""} key={number}><span>{index === 0 ? <Check size={13} /> : number}</span><b>{title}</b><small>{index === 1 ? "Waiting for your approval" : index === 0 ? "Approved by you" : "Locked until the previous gate"}</small></div>)}</div>
          </div>
        </div>
      </section>

      <section className="marketing-trust-bar"><div className="container"><span><CircleCheck size={15} />Nothing important advances silently</span><span><Library size={15} />Evidence stays attached</span><span><Download size={15} />Exports preserve the audit trail</span></div></section>

      <section className="section stages-section" id="stages">
        <div className="container">
          <div className="center-section-heading"><span className="kicker">The complete journey</span><h2>Useful progress at every stage—not a long chat transcript.</h2><p>Each stage creates a durable project object that stays connected to the assignment and can be revised later.</p></div>
          <div className="stage-timeline">{stages.map(({ number, icon: Icon, title, text, object }) => <article key={number}><div className="stage-number">{number}</div><div className="stage-icon"><Icon size={22} /></div><div className="stage-copy"><h3>{title}</h3><p>{text}</p></div><div className="stage-object"><span>OUTPUT</span><b>{object}</b></div></article>)}</div>
        </div>
      </section>

      <section className="section gate-section">
        <div className="container gate-layout">
          <div><span className="kicker kicker--light">Student-in-the-loop</span><h2>Aido waits at the decisions that shape the work.</h2><p>Uploading a file does not authorize a full paper. The student confirms policy, requirements, sources, evidence, outline, material suggestions, and readiness to export.</p></div>
          <div className="gate-panel"><div><span>GATE 01</span><b>Policy and project facts</b><small>What assistance is actually permitted?</small><CircleCheck size={18} /></div><div><span>GATE 02</span><b>Requirement matrix</b><small>Did Aido interpret the task correctly?</small><CircleCheck size={18} /></div><div><span>GATE 03</span><b>Sources and evidence</b><small>What evidence is strong enough to use?</small><CircleCheck size={18} /></div><div><span>GATE 04</span><b>Outline and export</b><small>Does the structure cover the rubric?</small><CircleCheck size={18} /></div></div>
        </div>
      </section>
      <MarketingCta eyebrow="A process you can see and defend" title="Start with clarity, not a blank page." description="Your brief sets the direction. Your evidence supports the work. Your approval moves it forward." />
    </MarketingShell>
  );
}
