"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp, LoaderCircle } from "lucide-react";
import { completeProjectSetupAction } from "@/lib/projects/actions";
import { uploadProjectDocument } from "@/lib/projects/upload-client";
import { ACCEPTED_ASSIGNMENT_FILES, validateAssignmentFile } from "@/lib/projects/config";
import type { AidoDocumentKind } from "@/lib/supabase/types";

export function ProjectDocumentUploader({
  projectId,
  userId,
  kind,
  label,
  completeAfterUpload = false,
  replaceDocumentId,
}: {
  projectId: string;
  userId: string;
  kind: AidoDocumentKind;
  label: string;
  completeAfterUpload?: boolean;
  replaceDocumentId?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function selectFile(file: File | null) {
    if (!file) return;
    const validationError = validateAssignmentFile(file);
    if (validationError) return setError(validationError);
    setError(null);
    startTransition(async () => {
      const result = await uploadProjectDocument({ file, kind, projectId, userId, replaceDocumentId });
      if (!result.ok) return setError(result.error);
      if (completeAfterUpload) {
        const completeResult = await completeProjectSetupAction(projectId);
        if (!completeResult.ok) return setError(completeResult.error);
      }
      router.refresh();
    });
  }

  return (
    <div className="inline-uploader">
      <label className="button button--secondary">
        {isPending ? <LoaderCircle className="spin" size={17} /> : <FileUp size={17} />}
        {isPending ? "Uploading" : label}
        <input className="sr-only" type="file" accept={ACCEPTED_ASSIGNMENT_FILES} disabled={isPending} onChange={(event) => selectFile(event.target.files?.[0] ?? null)} />
      </label>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
