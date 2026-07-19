"use client";

import { createClient } from "@/lib/supabase/client";
import { registerProjectDocumentAction } from "@/lib/projects/actions";
import {
  ASSIGNMENT_FILE_BUCKET,
  normalizedMimeType,
  safeStorageFilename,
  validateAssignmentFile,
} from "@/lib/projects/config";
import type { AidoDocumentKind } from "@/lib/supabase/types";

export async function uploadProjectDocument(input: {
  file: File;
  kind: AidoDocumentKind;
  projectId: string;
  userId: string;
  replaceDocumentId?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const validationError = validateAssignmentFile(input.file);
  if (validationError) return { ok: false, error: validationError };

  const mimeType = normalizedMimeType(input.file.name);
  if (!mimeType) return { ok: false, error: "That file type is not supported." };

  const storagePath = `${input.userId}/${input.projectId}/${crypto.randomUUID()}-${safeStorageFilename(input.file.name)}`;
  const supabase = createClient();
  const { error: uploadError } = await supabase.storage
    .from(ASSIGNMENT_FILE_BUCKET)
    .upload(storagePath, input.file, {
      cacheControl: "3600",
      contentType: mimeType,
      upsert: false,
    });

  if (uploadError) return { ok: false, error: "The file upload failed. Check your connection and retry." };

  const result = await registerProjectDocumentAction({
    projectId: input.projectId,
    kind: input.kind,
    originalFilename: input.file.name,
    storagePath,
    mimeType,
    sizeBytes: input.file.size,
    replaceDocumentId: input.replaceDocumentId,
  });

  if (!result.ok) return result;
  return { ok: true };
}
