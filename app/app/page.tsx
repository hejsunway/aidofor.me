import Link from "next/link";
import { ArrowRight, CalendarDays, FileCheck2, Plus, ShieldCheck } from "lucide-react";
import { listProjects } from "@/lib/projects/queries";
import { formatProjectDate, integrityModeLabel } from "@/lib/projects/config";

export default async function WorkspaceHomePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const params = await searchParams;
  const view = params.view === "archived" ? "archived" : "active";
  const projects = await listProjects(view);

  return (
    <main className="app-content">
      <section className="workspace-heading">
        <div className="workspace-heading__copy"><h1>Your assignments</h1><p>Continue a piece of work or begin with a new brief.</p></div>
        <Link className="button button--primary" href="/app/new"><Plus size={17} />New assignment</Link>
      </section>

      <section className="projects-section">
        <div className="projects-section__header">
          <div><h2>{view === "active" ? "Recent" : "Archived"}</h2><span>{projects.length} {projects.length === 1 ? "assignment" : "assignments"}</span></div>
          <nav className="view-toggle" aria-label="Project status">
            <Link className={view === "active" ? "is-active" : ""} href="/app">Active</Link>
            <Link className={view === "archived" ? "is-active" : ""} href="/app?view=archived">Archived</Link>
          </nav>
        </div>

        {projects.length ? (
          <div className="project-list">
            {projects.map((project) => (
              <Link className="project-card" href={`/app/projects/${project.id}`} key={project.id}>
                <div className="project-card__identity"><span className="project-card__type">{project.assignment_type}</span><h3>{project.title}</h3><p>{project.course_name || "No course added"}</p></div>
                <dl className="project-card__facts"><div><dt><CalendarDays size={15} />Deadline</dt><dd>{formatProjectDate(project.deadline)}</dd></div><div><dt><FileCheck2 size={15} />Files</dt><dd>{project.documentCount}</dd></div></dl>
                <div className="project-card__policy"><ShieldCheck size={15} /><span>{integrityModeLabel(project.integrity_mode)}</span></div>
                <div className="project-card__open"><span className={`status-badge status-badge--${project.status}`}>{project.status === "setup" ? "Setup needed" : project.status}</span><ArrowRight size={18} aria-hidden="true" /></div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-projects">
            <span className="empty-projects__mark" aria-hidden="true">a</span>
            <h3>{view === "active" ? "Start with an assignment brief" : "Nothing archived"}</h3>
            <p>{view === "active" ? "Upload your real brief and Aido will keep the work organised here." : "Assignments you archive will appear here."}</p>
            {view === "active" && <Link className="text-link" href="/app/new">New assignment <ArrowRight size={17} /></Link>}
          </div>
        )}
      </section>
    </main>
  );
}
