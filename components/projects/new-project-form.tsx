"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Check,
  FileCheck2,
  FileText,
  Info,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import { completeProjectSetupAction, createProjectAction } from "@/lib/projects/actions";
import { uploadProjectDocument } from "@/lib/projects/upload-client";
import {
  ACCEPTED_ASSIGNMENT_FILES,
  ASSIGNMENT_TYPES,
  CITATION_STYLES,
  INTEGRITY_MODES,
  formatFileSize,
  validateAssignmentFile,
} from "@/lib/projects/config";
import type { AidoIntegrityMode } from "@/lib/supabase/types";

type UploadState = "idle" | "uploading" | "verified";

function FilePicker({
  label,
  help,
  file,
  required,
  state,
  onFile,
}: {
  label: string;
  help: string;
  file: File | null;
  required?: boolean;
  state: UploadState;
  onFile: (file: File | null) => void;
}) {
  return (
    <label className={`upload-zone${file ? " has-file" : ""}`}>
      {state === "uploading" ? <LoaderCircle className="spin" size={27} /> : file ? <FileCheck2 size={27} /> : <UploadCloud size={27} />}
      <b>{label}{!required && <em>Optional</em>}</b>
      <span>{file ? `${file.name} · ${formatFileSize(file.size)}` : help}</span>
      <input
        type="file"
        accept={ACCEPTED_ASSIGNMENT_FILES}
        disabled={state === "uploading"}
        onChange={(event) => onFile(event.target.files?.[0] ?? null)}
      />
    </label>
  );
}

export function NewProjectForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [brief, setBrief] = useState<File | null>(null);
  const [rubric, setRubric] = useState<File | null>(null);
  const [briefState, setBriefState] = useState<UploadState>("idle");
  const [rubricState, setRubricState] = useState<UploadState>("idle");
  const [integrityMode, setIntegrityMode] = useState<AidoIntegrityMode>("unknown");
  const [error, setError] = useState<string | null>(null);
  const [savedProjectId, setSavedProjectId] = useState<string | null>(null);

  function chooseFile(file: File | null, setter: (file: File | null) => void) {
    setError(null);
    if (!file) return setter(null);
    const fileError = validateAssignmentFile(file);
    if (fileError) {
      setter(null);
      setError(fileError);
      return;
    }
    setter(file);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (savedProjectId) {
      router.push(`/app/projects/${savedProjectId}`);
      return;
    }
    if (!brief) {
      setError("Upload the assignment brief to continue.");
      return;
    }

    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const createResult = await createProjectAction({
        title: String(form.get("title") ?? ""),
        courseName: String(form.get("courseName") ?? ""),
        assignmentType: String(form.get("assignmentType") ?? ""),
        deadline: String(form.get("deadline") ?? ""),
        targetWordCount: String(form.get("targetWordCount") ?? ""),
        citationStyle: String(form.get("citationStyle") ?? ""),
        integrityMode,
        policyText: String(form.get("policyText") ?? ""),
      });
      if (!createResult.ok) {
        setError(createResult.error);
        return;
      }

      setSavedProjectId(createResult.projectId);
      setBriefState("uploading");
      const briefResult = await uploadProjectDocument({
        file: brief,
        kind: "brief",
        projectId: createResult.projectId,
        userId: createResult.userId,
      });
      if (!briefResult.ok) {
        setBriefState("idle");
        setError(`${briefResult.error} The assignment was saved so you can retry.`);
        return;
      }
      setBriefState("verified");

      if (rubric) {
        setRubricState("uploading");
        const rubricResult = await uploadProjectDocument({
          file: rubric,
          kind: "rubric",
          projectId: createResult.projectId,
          userId: createResult.userId,
        });
        if (!rubricResult.ok) {
          setRubricState("idle");
          setError(`${rubricResult.error} The brief is saved; add the rubric from the assignment page.`);
          router.push(`/app/projects/${createResult.projectId}`);
          return;
        }
        setRubricState("verified");
      }

      const completeResult = await completeProjectSetupAction(createResult.projectId);
      if (!completeResult.ok) {
        setError(completeResult.error);
        router.push(`/app/projects/${createResult.projectId}`);
        return;
      }
      router.push(`/app/projects/${createResult.projectId}`);
      router.refresh();
    });
  }

  return (
    <form className="project-form" onSubmit={submit}>
      <section className="form-section">
        <div className="form-section__heading"><span>1</span><div><h2>Add the assignment files</h2><p>The brief is required. Add the rubric if you have it.</p></div></div>
        <div className="upload-grid">
          <FilePicker label="Assignment brief" help="PDF, Word, image, or text · 25 MB max" file={brief} required state={briefState} onFile={(file) => chooseFile(file, setBrief)} />
          <FilePicker label="Marking rubric" help="Upload it separately for clearer criteria" file={rubric} state={rubricState} onFile={(file) => chooseFile(file, setRubric)} />
        </div>
        <div className="privacy-inline"><LockKeyhole size={16} /><span>Private storage. Every file is verified before it is registered.</span></div>
      </section>

      <section className="form-section">
        <div className="form-section__heading"><span>2</span><div><h2>Add the details</h2><p>Use the wording from your course.</p></div></div>
        <div className="field-grid">
          <label><span>Project title</span><input name="title" type="text" required maxLength={160} placeholder="Leadership theory analysis" /></label>
          <label><span>Course or module <em>Optional</em></span><input name="courseName" type="text" maxLength={160} placeholder="Organisational Behaviour" /></label>
          <label><span>Assignment type</span><select name="assignmentType" defaultValue="" required><option value="" disabled>Select a type</option>{ASSIGNMENT_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
          <label><span>Deadline <em>Optional</em></span><div className="input-with-icon"><CalendarDays size={17} /><input name="deadline" type="date" /></div></label>
          <label><span>Target words <em>Optional</em></span><input name="targetWordCount" type="number" min="100" max="100000" step="100" placeholder="2000" /></label>
          <label><span>Citation style</span><select name="citationStyle" defaultValue="APA 7">{CITATION_STYLES.map((style) => <option key={style}>{style}</option>)}</select></label>
        </div>
      </section>

      <section className="form-section">
        <div className="form-section__heading"><span>3</span><div><h2>What does your course allow?</h2><p>Course and instructor rules always take priority.</p></div></div>
        <div className="policy-notice"><Info size={19} /><span><b>Not sure?</b> Choose Unknown. Drafting will stay locked.</span></div>
        <fieldset className="mode-grid">
          <legend className="sr-only">Academic integrity mode</legend>
          {INTEGRITY_MODES.map((mode) => (
            <label className="mode-card" key={mode.value}>
              <input type="radio" name="integrityMode" value={mode.value} checked={integrityMode === mode.value} onChange={() => setIntegrityMode(mode.value)} />
              <span className="mode-radio"><Check size={12} /></span>
              <div><b>{mode.name}{mode.recommended && <em>Safest default</em>}</b><small>{mode.description}</small></div>
            </label>
          ))}
        </fieldset>
        <label className="policy-text"><span>Course policy wording <em>Optional</em></span><textarea name="policyText" rows={4} maxLength={20000} placeholder="Paste the relevant wording here." /></label>
      </section>

      {error && <div className="form-error" role="alert">{error}{savedProjectId && <a href={`/app/projects/${savedProjectId}`}> Open saved project</a>}</div>}
      <div className="form-actions">
        <div><ShieldCheck size={20} /><span><b>Your assignment stays private.</b><small>Nothing is generated during setup.</small></span></div>
        <button className="button button--primary" type="submit" disabled={isPending}>
          {isPending ? <><LoaderCircle className="spin" size={17} />Saving assignment</> : savedProjectId ? <><FileText size={17} />Open saved assignment</> : <><FileText size={17} />Create assignment</>}
        </button>
      </div>
    </form>
  );
}
