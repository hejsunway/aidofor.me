"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { AutoplayVideo } from "@/components/marketing/autoplay-video";

type HowAidoExperienceProps = {
  src?: string;
};

const workflowStages = [
  {
    description: "Turn briefs, rubrics, and instructions into a clear plan.",
    title: "Understand the assignment",
  },
  {
    description: "Organise credible sources and connect important claims to supporting evidence.",
    title: "Build from real evidence",
  },
  {
    description: "Check requirements, structure, citations, and source support before completing your work.",
    title: "Review before export",
  },
];

const videoDescription =
  "An animation representing assignment analysis, research, evidence organisation, outlining, drafting, verification, and export.";

export function HowAidoExperience({ src }: HowAidoExperienceProps) {
  const [activeStage, setActiveStage] = useState(0);

  return (
    <div className="how-aido__layout">
      <div className="how-aido__copy">
        <p className="how-aido__description">
          See how AidoFor.me helps you understand your requirements, organise credible research, connect claims to evidence, structure your paper, and verify your work before export.
        </p>

        <div className="how-aido-timeline" aria-label="Aido workflow stages">
          {workflowStages.map(({ description, title }, index) => {
            const isActive = index === activeStage;

            return (
              <article className={isActive ? "is-active" : undefined} key={title}>
                <div className="how-aido-timeline__rail" aria-hidden="true">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {index < workflowStages.length - 1 ? <i><b /></i> : null}
                </div>
                <div className="how-aido-timeline__content">
                  <h3>{title}</h3>
                  <div className="how-aido-timeline__reveal">
                    <p>{description}</p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <nav className="how-aido__actions" aria-label="How Aido next steps">
          <Link className="button button--primary button--large" href="/signup">
            Start your project <ArrowUpRight aria-hidden="true" size={18} />
          </Link>
          <Link className="button button--secondary button--large" href="/how-it-works">
            Explore the full workflow <ArrowRight aria-hidden="true" size={18} />
          </Link>
        </nav>
      </div>

      <figure className="how-aido__figure">
        <span className="sr-only" id="how-aido-video-description">
          {videoDescription}
        </span>
        <div className="how-aido-video">
          {src ? (
            <AutoplayVideo
              describedBy="how-aido-video-description"
              label="How Aido supports an academic writing project"
              onTimeUpdate={(currentTime) => {
                const nextStage = Math.min(2, Math.floor(currentTime / 10));
                setActiveStage(nextStage);
              }}
              src={src}
            />
          ) : (
            <div
              aria-describedby="how-aido-video-description"
              aria-label="How Aido supports an academic writing project"
              className="how-aido-video__fallback"
              role="img"
            />
          )}
        </div>
        <figcaption className="sr-only">
          A visual overview of the Aido academic-writing workflow.
        </figcaption>
      </figure>
    </div>
  );
}
