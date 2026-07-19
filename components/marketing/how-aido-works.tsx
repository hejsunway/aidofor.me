import { existsSync } from "node:fs";
import { join } from "node:path";
import { HowAidoExperience } from "@/components/marketing/how-aido-experience";

const videoPublicPath = "/videos/aido-writing-journey-autoplay.mp4";

export function HowAidoWorks() {
  const publicDirectory = join(process.cwd(), "public");
  const videoSrc = existsSync(join(publicDirectory, videoPublicPath)) ? videoPublicPath : undefined;

  return (
    <section className="how-aido" id="how-it-works">
      <div className="container">
        <header className="how-aido__header">
          <span className="how-aido__eyebrow">How Aido works</span>
          <h2>From assignment brief to evidence-backed writing</h2>
        </header>

        <HowAidoExperience src={videoSrc} />
      </div>
    </section>
  );
}
