import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpenCheck,
  Check,
  CheckCircle2,
  Clapperboard,
  FileCheck2,
  FileQuestion,
  Highlighter,
  Library,
  Link2,
  ListChecks,
  Play,
  SearchCheck,
  ShieldCheck,
  Star,
} from "lucide-react";
import { AutoplayVideo } from "@/components/marketing/autoplay-video";
import { AssignmentIntelligence } from "@/components/marketing/assignment-intelligence";
import { HowAidoWorks } from "@/components/marketing/how-aido-works";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { UniversityTrust } from "@/components/marketing/university-trust";

const workflow = [
  {
    number: "01",
    title: "Confirm the brief",
    text: "Upload the assignment and rubric, then approve every extracted requirement and ambiguity.",
    icon: FileCheck2,
  },
  {
    number: "02",
    title: "Plan the research",
    text: "Turn the confirmed task into research questions, search terms, and source criteria.",
    icon: SearchCheck,
  },
  {
    number: "03",
    title: "Map evidence to the rubric",
    text: "Approve real sources, save exact passages, and give every criterion a place in the outline.",
    icon: Highlighter,
  },
  {
    number: "04",
    title: "Write, verify, and export",
    text: "Draft section by section, inspect citations, resolve gaps, and export only when you are ready.",
    icon: BookOpenCheck,
  },
];

const faqs = [
  [
    "Will Aido write my whole assignment for me?",
    "No. Aido is a guided research and writing workspace. It helps you understand the task, organize evidence, plan the argument, and improve work that you review and approve.",
  ],
  [
    "Can Aido invent references?",
    "No. Citations are created from real source records, and important claims remain connected to passages you can inspect.",
  ],
  [
    "What if my course limits AI use?",
    "Each project begins with an AI-permission mode. Aido limits its assistance to the rules you confirm for that assignment.",
  ],
  [
    "Are my projects private?",
    "Projects are private by default, with authenticated access and project-scoped storage planned throughout the production architecture.",
  ],
];

type VideoSlotProps = {
  number: string;
  name: string;
  title: string;
  description: string;
  format?: "wide" | "standard";
};

function VideoSlot({ number, name, title, description, format = "standard" }: VideoSlotProps) {
  return (
    <div
      className={`landing-video-slot landing-video-slot--${format}`}
      data-video-slot={name}
      aria-label={`${title} video placeholder`}
    >
      <div className="landing-video-slot__top">
        <span><Clapperboard size={16} aria-hidden="true" /> Video placeholder {number}</span>
        <code>{name}.mp4</code>
      </div>
      <div className="landing-video-slot__center">
        <span className="landing-video-slot__play" aria-hidden="true"><Play size={22} fill="currentColor" /></span>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="landing-video-slot__meta">
        <span>{format === "wide" ? "16:10" : "4:3"} landscape</span>
        <span>10–12 second loop</span>
        <span>White background</span>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <MarketingShell>
      <div className="landing-page landing-page--video">
        <section className="landing-hero">
          <div className="container landing-hero__copy">
            <div className="landing-eyebrow"><span>Assignment-first writing</span></div>
            <h1>Understand the assignment.<br /><span>Then write work you can defend.</span></h1>
            <p>Aido turns your brief and rubric into a verified, source-backed writing plan—then keeps every requirement, quotation, and citation connected as you work.</p>
            <div className="landing-actions">
              <Link className="button button--primary button--large" href="/signup">Start with your brief <ArrowUpRight size={18} aria-hidden="true" /></Link>
              <Link className="button button--secondary button--large" href="/how-it-works">See how it works <ArrowRight size={18} aria-hidden="true" /></Link>
            </div>
            <div className="landing-hero__note"><ShieldCheck size={16} aria-hidden="true" /> Private by default · You approve every important stage · You remain the author</div>
          </div>

          <div className="container landing-hero__stage">
            <div className="landing-hero-video" aria-label="Aido assignment journey animation">
              <AutoplayVideo
                label="Aido assignment journey animation"
                src="/videos/hero-assignment-journey-autoplay.mp4"
              />
            </div>
            <div className="landing-student-proof" aria-label="Rated 4.9 out of 5 by 4268 students">
              <div className="landing-student-proof__avatars" aria-hidden="true">
                {[1, 2, 3, 4].map((student) => (
                  <Image
                    alt=""
                    height={40}
                    key={student}
                    src={`/images/student-avatars/student-${student}.webp`}
                    width={40}
                  />
                ))}
              </div>
              <p><strong>4.9/5</strong> from <strong>4268 students</strong></p>
              <Star aria-hidden="true" fill="currentColor" size={18} />
            </div>
          </div>
        </section>

        <UniversityTrust />

        <HowAidoWorks />

        <AssignmentIntelligence />

        <section className="landing-section landing-problem">
          <div className="container">
            <div className="landing-heading landing-heading--center">
              <span>The difficult part comes first</span>
              <h2>A strong paper starts long before the first sentence.</h2>
              <p>A polished draft still misses the mark when the task, source, or grading criteria were misunderstood at the beginning.</p>
            </div>
            <div className="landing-problem__grid">
              <article><FileQuestion size={23} /><small>01 · THE BRIEF</small><h3>What does this actually ask me to do?</h3><p>Find the command verbs, required theories, format rules, and conflicts before research begins.</p></article>
              <article><Library size={23} /><small>02 · THE SOURCES</small><h3>Does this source really support my claim?</h3><p>Keep exact passages, page locators, source status, and your interpretation together.</p></article>
              <article><ListChecks size={23} /><small>03 · THE RUBRIC</small><h3>Am I spending words where the marks are?</h3><p>Map every criterion to an outline section, analytical move, evidence target, and word budget.</p></article>
            </div>
          </div>
        </section>

        <section className="landing-section landing-process" id="workflow">
          <div className="container">
            <div className="landing-heading landing-heading--center">
              <span>A visible academic workflow</span>
              <h2>From confusing brief to defensible work.</h2>
              <p>Every stage produces something you can inspect, edit, and approve—not another answer buried in a chat.</p>
            </div>
            <div className="landing-process__layout">
              <div className="landing-process__steps">
                {workflow.map(({ number, title, text, icon: Icon }) => (
                  <article key={number}>
                    <div className="landing-process__number">{number}</div>
                    <div>
                      <span><Icon size={19} aria-hidden="true" /></span>
                      <h3>{title}</h3>
                      <p>{text}</p>
                    </div>
                  </article>
                ))}
              </div>
              <VideoSlot
                number="02"
                name="brief-to-outline"
                title="Brief to outline"
                description="Show the assignment and rubric being read, ambiguities flagged, requirements confirmed, and a weighted outline assembled."
              />
            </div>
          </div>
        </section>

        <section className="landing-section landing-showcase" id="evidence">
          <div className="container landing-showcase__row">
            <div className="landing-showcase__copy">
              <span className="landing-index">01 · EVIDENCE BEFORE PROSE</span>
              <h2>See what supports every important claim.</h2>
              <p>A citation is useful only when you can open it and check what the source actually says. Aido keeps the passage, page, context, and your interpretation together.</p>
              <ul>
                <li><CheckCircle2 size={18} /><span><b>Exact passages</b><small>Quotations stay tied to their page or section locator.</small></span></li>
                <li><CheckCircle2 size={18} /><span><b>Visible source status</b><small>Know whether you have full text, an abstract, or metadata only.</small></span></li>
                <li><CheckCircle2 size={18} /><span><b>Student approval</b><small>Only approved evidence can ground section writing.</small></span></li>
              </ul>
            </div>
            <VideoSlot
              number="03"
              name="evidence-and-citations"
              title="Evidence you can inspect"
              description="Animate a real source passage becoming an evidence card, then connecting to a claim and citation with a clear page locator."
            />
          </div>
        </section>

        <section className="landing-section landing-showcase landing-showcase--reverse">
          <div className="container landing-showcase__row">
            <VideoSlot
              number="04"
              name="rubric-mapped-plan"
              title="Plan for the marks"
              description="Animate rubric criteria connecting to outline sections, analytical moves, approved evidence, and balanced word budgets."
            />
            <div className="landing-showcase__copy">
              <span className="landing-index">02 · THE RUBRIC STAYS IN VIEW</span>
              <h2>Plan for the marks before spending the words.</h2>
              <p>Aido maps every confirmed criterion to a section, word budget, and evidence target. Missing coverage appears while the structure is still easy to fix.</p>
              <div className="landing-stat-row">
                <div><strong>100%</strong><span>mandatory criteria given a planned home</span></div>
                <div><strong>Visible</strong><span>coverage, gaps, and approval status</span></div>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-section landing-showcase">
          <div className="container landing-showcase__row">
            <div className="landing-showcase__copy">
              <span className="landing-index">03 · REVIEW BEFORE EXPORT</span>
              <h2>Check the work while there is still time to improve it.</h2>
              <p>Before export, Aido checks requirements, rubric coverage, citation metadata, claim support, source quality, and unresolved warnings—without pretending to guarantee a grade.</p>
              <Link className="landing-text-link" href="/features/evidence-and-citations">Explore evidence and citation checks <ArrowRight size={16} /></Link>
            </div>
            <VideoSlot
              number="05"
              name="review-and-export"
              title="Citation and requirement audit"
              description="Show unsupported claims being flagged, citations opening to their evidence, rubric gaps resolving, and a student-approved export becoming ready."
            />
          </div>
        </section>

        <section className="landing-section landing-integrity" id="integrity">
          <div className="container">
            <div className="landing-heading landing-heading--center">
              <span>Academic integrity, built into the product</span>
              <h2>AI that works with your rules.</h2>
              <p>The assignment policy controls what Aido can help with. Important transitions wait for your approval, and uncertainty stays visible.</p>
            </div>
            <div className="landing-integrity__grid">
              <article><span><Check size={19} /></span><h3>Policy before capability</h3><p>Choose No AI, Planning only, Assistive writing, or Open AI for each assignment.</p></article>
              <article><span><Link2 size={19} /></span><h3>No citation without a source</h3><p>References come from resolved source records—not language-model memory.</p></article>
              <article><span><ShieldCheck size={19} /></span><h3>No detector or humanizer</h3><p>Aido focuses on honest process history, verification, and student revision.</p></article>
              <article><span><CheckCircle2 size={19} /></span><h3>You make the final call</h3><p>Review, revise, approve, export, and submit the work personally.</p></article>
            </div>
          </div>
        </section>

        <section className="landing-section landing-difference">
          <div className="container landing-difference__card">
            <div>
              <span>Assignment-first, not document-first</span>
              <h2>More than a blank editor with AI attached.</h2>
              <p>Generic writing tools begin when you are ready to draft. Aido begins earlier, when the assignment still needs to be understood, researched, and planned.</p>
            </div>
            <div className="landing-difference__checks">
              <span><CheckCircle2 size={18} /> Brief and rubric confirmation</span>
              <span><CheckCircle2 size={18} /> Exact evidence passages and locators</span>
              <span><CheckCircle2 size={18} /> Rubric-mapped outline and word budget</span>
              <span><CheckCircle2 size={18} /> Citation and requirement audit</span>
            </div>
          </div>
        </section>

        <section className="landing-section landing-faq">
          <div className="container landing-faq__layout">
            <div className="landing-faq__heading"><span>Questions, answered plainly</span><h2>What students should know before starting.</h2><p>Aido makes the process more defensible. It does not make student responsibility disappear.</p></div>
            <div className="landing-faq__list">
              {faqs.map(([question, answer], index) => (
                <details key={question} open={index === 0}>
                  <summary>{question}<span>+</span></summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-final">
          <div className="container landing-final__card">
            <span>Start with the assignment you actually have</span>
            <h2>Bring the brief.<br />Build work you can defend.</h2>
            <p>Research with evidence. Write in your voice.</p>
            <div className="landing-actions">
              <Link className="button button--primary button--large" href="/signup">Start a project <ArrowUpRight size={18} aria-hidden="true" /></Link>
              <Link className="button button--secondary button--large" href="/how-it-works">See the complete workflow <ArrowRight size={18} aria-hidden="true" /></Link>
            </div>
          </div>
        </section>
      </div>
    </MarketingShell>
  );
}
