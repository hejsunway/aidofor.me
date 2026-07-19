import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileCheck2,
  FileText,
  LockKeyhole,
  Paperclip,
  ShieldCheck,
} from "lucide-react";
import { getProject } from "@/lib/projects/queries";
import {
  formatFileSize,
  formatProjectDate,
  integrityModeLabel,
} from "@/lib/projects/config";
import { ProjectDocumentUploader } from "@/components/projects/project-document-uploader";
import { ProjectFileDownload } from "@/components/projects/project-file-download";
import { ProjectActions } from "@/components/projects/project-actions";

const activityLabels: Record<string, string> = {
  "project.created": "Project created",
  "document.uploaded": "File verified and saved",
  "document.replaced": "File replaced and verified",
  "project.policy_confirmed": "Course policy confirmed",
  "project.setup_completed": "Setup completed",
  "project.archived": "Project archived",
  "project.restored": "Project restored",
};

function formatActivityDate(value: string): string {
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const data = await getProject(projectId);
  if (!data) notFound();

  const { project, documents, activity, phaseOneCompletionAvailable } = data;
  const hasBrief = documents.some((document) => document.kind === "brief");
  const hasRubric = documents.some((document) => document.kind === "rubric");

  return (
    <main className="project-workbench">
      <header className="project-workbench__bar">
        <Link className="project-workbench__back" href="/app"><ArrowLeft size={16} /><span>Assignments</span></Link>
        <div className="project-workbench__title">
          <b>{project.title}</b>
          <span>{project.assignment_type}</span>
        </div>
        <ProjectActions projectId={project.id} status={project.status} />
      </header>

      <div className="project-workbench__scroll">
        <div className="project-thread">
          <header className="project-thread__intro">
            <span className="aido-mark" aria-hidden="true">a</span>
            <div className="project-detail__labels">
              <span className={`status-badge status-badge--${project.status}`}>{project.status === "setup" ? "Setup needed" : project.status}</span>
              <span>{project.course_name || "Course not added"}</span>
            </div>
            <h1>{project.title}</h1>
            <p>A private workspace for the brief, evidence, decisions, and writing.</p>
          </header>

          <dl className="project-context-strip" aria-label="Assignment context">
            <div><dt><CalendarDays size={14} />Deadline</dt><dd>{formatProjectDate(project.deadline)}</dd></div>
            <div><dt><FileText size={14} />Length</dt><dd>{project.target_word_count ? `${project.target_word_count.toLocaleString()} words` : "Not set"}</dd></div>
            <div><dt><FileCheck2 size={14} />Citations</dt><dd>{project.citation_style}</dd></div>
            <div><dt><ShieldCheck size={14} />AI policy</dt><dd>{integrityModeLabel(project.integrity_mode)}</dd></div>
          </dl>

          {project.status === "setup" && (
            <section className="workbench-notice workbench-notice--setup">
              <LockKeyhole size={18} />
              <div><h2>Finish setting up this assignment</h2><p>{hasBrief ? "The brief is saved. Complete setup to activate the workspace." : "Upload the assignment brief to activate the workspace."}</p></div>
              {!hasBrief && <ProjectDocumentUploader projectId={project.id} userId={project.owner_id} kind="brief" label="Upload brief" completeAfterUpload />}
            </section>
          )}

          <section className="workbench-message" aria-labelledby="workspace-status-title">
            <span className="workbench-message__avatar" aria-hidden="true">a</span>
            <div className="workbench-message__body">
              <div className="workbench-message__author"><b>Aido</b><span>Assignment workspace</span></div>
              <h2 id="workspace-status-title">{project.status === "active" ? "Your assignment is ready." : "Let’s prepare the assignment."}</h2>
              <p>{project.status === "active" ? "Your source files and course settings are saved. Requirement analysis will begin here when that pipeline is connected." : "Add the required brief so the assignment can move into requirement analysis."}</p>

              <div className="workbench-files">
                <div className="workbench-files__heading">
                  <span><Paperclip size={14} />Files</span>
                  {!hasRubric && <ProjectDocumentUploader projectId={project.id} userId={project.owner_id} kind="rubric" label="Add rubric" />}
                </div>
                {documents.length ? (
                  <div className="document-list">
                    {documents.map((document) => (
                      <div className="document-row" key={document.id}>
                        <span className="document-row__icon"><FileText size={17} /></span>
                        <span><b>{document.original_filename}</b><small>{document.kind} · {formatFileSize(document.size_bytes)}</small></span>
                        <span className="verified-mark"><CheckCircle2 size={14} />Verified</span>
                        {phaseOneCompletionAvailable && <ProjectDocumentUploader projectId={project.id} userId={project.owner_id} kind={document.kind} label="Replace" replaceDocumentId={document.id} />}
                        <ProjectFileDownload path={document.storage_path} filename={document.original_filename} />
                      </div>
                    ))}
                  </div>
                ) : <p className="workbench-files__empty">No assignment files have been registered.</p>}
              </div>
            </div>
          </section>

          <details className="workbench-activity">
            <summary><span><Clock3 size={14} />Activity</span><ChevronDown size={15} /></summary>
            <ol className="activity-list">
              {activity.map((item) => <li key={item.id}><i /><span><b>{activityLabels[item.event_type] || item.event_type}</b><small>{formatActivityDate(item.created_at)}</small></span></li>)}
            </ol>
          </details>

          {project.status === "active" && (
            <div className="workbench-composer" aria-label="Assignment workflow status">
              <span>Requirement analysis is the next implementation phase.</span>
              <span className="workbench-composer__state"><i />Not connected</span>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
