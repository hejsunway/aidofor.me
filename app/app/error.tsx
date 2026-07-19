"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error("[aidofor-me] workspace error", error), [error]);
  return (
    <main className="app-content">
      <section className="workspace-error" role="alert">
        <h1>We couldn&apos;t load this workspace.</h1>
        <p>Your saved data has not been changed.</p>
        <div><button className="button button--primary" type="button" onClick={reset}>Try again</button><Link className="button button--secondary" href="/app">Projects</Link></div>
      </section>
    </main>
  );
}
