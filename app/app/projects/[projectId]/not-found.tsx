import Link from "next/link";

export default function ProjectNotFound() {
  return (
    <main className="app-content"><section className="workspace-error"><h1>Project not found</h1><p>It may have been deleted, or you may not have access.</p><Link className="button button--primary" href="/app">Back to projects</Link></section></main>
  );
}
