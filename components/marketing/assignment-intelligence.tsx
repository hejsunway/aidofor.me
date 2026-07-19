import { ClipboardCheck } from "lucide-react";
import { AutoplayVideo } from "@/components/marketing/autoplay-video";
import {
  AssignmentIntelligenceVisual,
  type AssignmentVisualKind,
} from "@/components/marketing/assignment-intelligence-visuals";

const capabilities = [
  {
    description: "Turn assignment briefs, marking rubrics, and course instructions into confirmed requirements you can review.",
    title: "Understands your assignment",
    visual: "assignment" as AssignmentVisualKind,
  },
  {
    description: "Connect every criterion to an outline section, analytical move, evidence target, and realistic word budget.",
    title: "Maps the rubric to your plan",
    visual: "rubric" as AssignmentVisualKind,
  },
  {
    description: "Save credible sources with exact quotations, page locators, and clear links to the claims they support.",
    title: "Keeps evidence connected",
    visual: "evidence" as AssignmentVisualKind,
  },
  {
    description: "Approve important stages, follow your course’s AI policy, and keep responsibility for every final decision.",
    title: "Protects student authorship",
    visual: "authorship" as AssignmentVisualKind,
  },
];

function CapabilityColumn({ items }: { items: typeof capabilities }) {
  return (
    <div className="assignment-intelligence__column">
      {items.map(({ description, title, visual }) => (
        <article key={title}>
          <h3>{title}</h3>
          <p>{description}</p>
          <AssignmentIntelligenceVisual kind={visual} />
        </article>
      ))}
    </div>
  );
}

export function AssignmentIntelligence() {
  return (
    <section className="assignment-intelligence" id="features">
      <div className="container">
        <header className="assignment-intelligence__header">
          <span><ClipboardCheck aria-hidden="true" size={15} /> Assignment-first academic workspace</span>
          <h2>AI-assisted academic writing, grounded in your brief and evidence</h2>
          <p>
            AidoFor.me helps university students analyse assignment briefs and rubrics, organise credible research, build evidence-backed outlines, verify citations, and review every requirement before export.
          </p>
        </header>

        <div className="assignment-intelligence__layout">
          <CapabilityColumn items={capabilities.slice(0, 2)} />

          <figure className="assignment-intelligence__video">
            <AutoplayVideo
              label="Aido organising an assignment into a verified academic writing workflow"
              src="/videos/aido-assignment-intelligence-autoplay.mp4"
            />
            <figcaption className="sr-only">
              A visual representation of Aido connecting assignment requirements, research evidence, planning, and student review.
            </figcaption>
          </figure>

          <CapabilityColumn items={capabilities.slice(2)} />
        </div>
      </div>
    </section>
  );
}
