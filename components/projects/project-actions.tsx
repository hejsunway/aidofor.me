"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Ellipsis, LoaderCircle, Trash2 } from "lucide-react";
import { deleteProjectAction, setProjectArchivedAction } from "@/lib/projects/actions";

export function ProjectActions({ projectId, status }: { projectId: string; status: "setup" | "active" | "archived" }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggleArchive() {
    setError(null);
    startTransition(async () => {
      const result = await setProjectArchivedAction(projectId, status !== "archived");
      if (!result.ok) return setError(result.error);
      router.refresh();
    });
  }

  function removeProject() {
    if (!window.confirm("Delete this project and all uploaded files? This cannot be undone.")) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteProjectAction(projectId);
      if (!result.ok) return setError(result.error);
      router.push("/app");
      router.refresh();
    });
  }

  return (
    <div className="project-actions">
      <details className="project-actions__menu">
        <summary aria-label="Project actions"><Ellipsis size={19} /></summary>
        <div>
          {status !== "setup" && <button type="button" disabled={isPending} onClick={toggleArchive}>
            {isPending ? <LoaderCircle className="spin" size={16} /> : status === "archived" ? <ArchiveRestore size={16} /> : <Archive size={16} />}
            {status === "archived" ? "Restore project" : "Archive project"}
          </button>}
          <button className="is-danger" type="button" disabled={isPending} onClick={removeProject}><Trash2 size={16} />Delete project</button>
        </div>
      </details>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
