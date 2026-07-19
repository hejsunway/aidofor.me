"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAuthId } from "@/lib/auth/actions";
import { ensureAidoMembership } from "@/lib/auth/membership";
import {
  ASSIGNMENT_FILE_BUCKET,
  ASSIGNMENT_TYPES,
  CITATION_STYLES,
  MAX_ARCHIVE_COMPRESSION_RATIO,
  MAX_ARCHIVE_ENTRY_COUNT,
  MAX_ARCHIVE_EXPANDED_BYTES,
  MAX_ASSIGNMENT_FILE_BYTES,
  fileExtension,
  isDocumentKind,
  normalizedMimeType,
} from "@/lib/projects/config";
import type { AidoIntegrityMode } from "@/lib/supabase/types";

type ActionError = { ok: false; error: string };
type ActionSuccess<T = Record<never, never>> = { ok: true } & T;
export type ProjectActionResult<T = Record<never, never>> = ActionError | ActionSuccess<T>;

export type CreateProjectInput = {
  title: string;
  courseName: string;
  assignmentType: string;
  deadline: string;
  targetWordCount: string;
  citationStyle: string;
  integrityMode: AidoIntegrityMode;
  policyText: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTEGRITY_MODES: AidoIntegrityMode[] = [
  "unknown",
  "no_ai",
  "planning_only",
  "assistive_writing",
  "open_required_ai",
];

function clean(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function userMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String(error.message)
      : "";
  if (message.includes("Active Aido membership")) return "Your Aido workspace is not active.";
  if (message.includes("Assignment brief required")) return "Upload the assignment brief first.";
  if (message.includes("Project file limit")) return "This project has reached its 12-file limit.";
  if (message.includes("Replacement document")) return "The file you tried to replace is no longer current.";
  if (message.includes("not found")) return "That project or file is no longer available.";
  return fallback;
}

async function authenticatedUser() {
  const user = await requireAuthId();
  if (!user) throw new Error("Authentication required");
  return user;
}

export async function createProjectAction(
  input: CreateProjectInput,
): Promise<ProjectActionResult<{ projectId: string; userId: string }>> {
  try {
    const user = await authenticatedUser();
    const title = clean(input.title, 160);
    const courseName = clean(input.courseName, 160);
    const policyText = clean(input.policyText, 20000);
    const words = input.targetWordCount ? Number(input.targetWordCount) : null;

    if (!title) return { ok: false, error: "Add a project title." };
    if (!ASSIGNMENT_TYPES.includes(input.assignmentType as (typeof ASSIGNMENT_TYPES)[number])) {
      return { ok: false, error: "Choose an assignment type." };
    }
    if (!CITATION_STYLES.includes(input.citationStyle as (typeof CITATION_STYLES)[number])) {
      return { ok: false, error: "Choose a citation style." };
    }
    if (!INTEGRITY_MODES.includes(input.integrityMode)) {
      return { ok: false, error: "Choose what your course allows." };
    }
    if (input.deadline && !/^\d{4}-\d{2}-\d{2}$/.test(input.deadline)) {
      return { ok: false, error: "Enter a valid deadline." };
    }
    if (words !== null && (!Number.isInteger(words) || words < 100 || words > 100000)) {
      return { ok: false, error: "Word count must be between 100 and 100,000." };
    }

    await ensureAidoMembership(user.id);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("aido_create_project", {
      p_title: title,
      p_course_name: courseName,
      p_assignment_type: input.assignmentType,
      p_deadline: input.deadline || null,
      p_target_word_count: words,
      p_citation_style: input.citationStyle,
      p_integrity_mode: input.integrityMode,
      p_policy_text: policyText,
    });
    if (error) throw error;

    revalidatePath("/app");
    return { ok: true, projectId: data, userId: user.id };
  } catch (error) {
    return { ok: false, error: userMessage(error, "The project could not be created. Try again.") };
  }
}

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function verifyZipArchiveLimits(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let entries = 0;
  let totalCompressed = 0;
  let totalExpanded = 0;
  let hasContentTypes = false;
  let hasWordDocument = false;

  for (let offset = 0; offset <= bytes.length - 46;) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      offset += 1;
      continue;
    }

    const compressed = view.getUint32(offset + 20, true);
    const expanded = view.getUint32(offset + 24, true);
    const filenameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const entryLength = 46 + filenameLength + extraLength + commentLength;
    if (offset + entryLength > bytes.length) return false;

    const filename = decoder.decode(bytes.subarray(offset + 46, offset + 46 + filenameLength));
    hasContentTypes ||= filename === "[Content_Types].xml";
    hasWordDocument ||= filename === "word/document.xml";
    entries += 1;
    totalCompressed += compressed;
    totalExpanded += expanded;

    if (
      entries > MAX_ARCHIVE_ENTRY_COUNT
      || totalExpanded > MAX_ARCHIVE_EXPANDED_BYTES
      || (totalCompressed > 0 && totalExpanded / totalCompressed > MAX_ARCHIVE_COMPRESSION_RATIO)
    ) return false;

    offset += entryLength;
  }

  return entries > 0 && hasContentTypes && hasWordDocument;
}

function verifyFileContent(bytes: Uint8Array, filename: string, mimeType: string): boolean {
  const extension = fileExtension(filename);
  if (normalizedMimeType(filename) !== mimeType) return false;

  if (extension === "pdf") {
    return Buffer.from(bytes.subarray(0, Math.min(bytes.length, 1024))).includes(Buffer.from("%PDF-"));
  }
  if (extension === "png") return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (extension === "jpg" || extension === "jpeg") return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
  if (extension === "doc") return hasPrefix(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  if (extension === "docx") {
    return hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04])
      && verifyZipArchiveLimits(bytes);
  }
  if (extension === "txt") {
    if (bytes.includes(0)) return false;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export async function registerProjectDocumentAction(input: {
  projectId: string;
  kind: string;
  originalFilename: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  replaceDocumentId?: string;
}): Promise<ProjectActionResult<{ documentId: string }>> {
  const supabase = await createClient();
  const removeUploadedObject = async () => {
    await supabase.storage.from(ASSIGNMENT_FILE_BUCKET).remove([input.storagePath]);
  };

  try {
    const user = await authenticatedUser();
    if (
      !UUID_PATTERN.test(input.projectId)
      || !isDocumentKind(input.kind)
      || (input.replaceDocumentId !== undefined && !UUID_PATTERN.test(input.replaceDocumentId))
    ) {
      return { ok: false, error: "The document details are invalid." };
    }
    const expectedPrefix = `${user.id}/${input.projectId}/`;
    if (!input.storagePath.startsWith(expectedPrefix)) {
      return { ok: false, error: "The upload path is invalid." };
    }
    if (
      !input.originalFilename
      || input.originalFilename.length > 255
      || normalizedMimeType(input.originalFilename) !== input.mimeType
      || !Number.isInteger(input.sizeBytes)
      || input.sizeBytes < 1
      || input.sizeBytes > MAX_ASSIGNMENT_FILE_BYTES
    ) {
      await removeUploadedObject();
      return { ok: false, error: "The uploaded file is not supported." };
    }

    let replacedStoragePath: string | null = null;
    if (input.replaceDocumentId) {
      const { data: replacedDocument, error: replacedDocumentError } = await supabase
        .from("aido_assignment_documents")
        .select("storage_path")
        .eq("id", input.replaceDocumentId)
        .eq("project_id", input.projectId)
        .is("replaced_at", null)
        .maybeSingle();
      if (replacedDocumentError || !replacedDocument) {
        await removeUploadedObject();
        return { ok: false, error: "The file you tried to replace is no longer current." };
      }
      replacedStoragePath = replacedDocument.storage_path;
    }

    const { data: blob, error: downloadError } = await supabase.storage
      .from(ASSIGNMENT_FILE_BUCKET)
      .download(input.storagePath);
    if (downloadError || !blob) {
      await removeUploadedObject();
      throw downloadError ?? new Error("Uploaded object not found");
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await blob.arrayBuffer());
    } catch (error) {
      await removeUploadedObject();
      throw error;
    }
    if (bytes.byteLength !== input.sizeBytes || !verifyFileContent(bytes, input.originalFilename, input.mimeType)) {
      await removeUploadedObject();
      return { ok: false, error: "The file content does not match its file type." };
    }

    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const rpcInput = {
      p_project_id: input.projectId,
      p_kind: input.kind,
      p_original_filename: input.originalFilename,
      p_storage_path: input.storagePath,
      p_mime_type: input.mimeType,
      p_size_bytes: input.sizeBytes,
      p_content_hash: contentHash,
    };
    const { data, error } = input.replaceDocumentId
      ? await supabase.rpc("aido_replace_assignment_document", {
          ...rpcInput,
          p_replaces_document_id: input.replaceDocumentId,
        })
      : await supabase.rpc("aido_register_assignment_document", rpcInput);
    if (error) {
      const { data: existing } = await supabase
        .from("aido_assignment_documents")
        .select("id")
        .eq("project_id", input.projectId)
        .eq("storage_path", input.storagePath)
        .maybeSingle();
      if (existing) return { ok: true, documentId: existing.id };
      await removeUploadedObject();
      throw error;
    }

    if (replacedStoragePath) {
      await supabase.storage.from(ASSIGNMENT_FILE_BUCKET).remove([replacedStoragePath]);
    }

    revalidatePath("/app");
    revalidatePath(`/app/projects/${input.projectId}`);
    return { ok: true, documentId: data };
  } catch (error) {
    return { ok: false, error: userMessage(error, "The file could not be verified. Try uploading it again.") };
  }
}

export async function completeProjectSetupAction(
  projectId: string,
): Promise<ProjectActionResult> {
  try {
    await authenticatedUser();
    if (!UUID_PATTERN.test(projectId)) return { ok: false, error: "The project ID is invalid." };
    const supabase = await createClient();
    const { error } = await supabase.rpc("aido_complete_project_setup", { p_project_id: projectId });
    if (error) throw error;
    revalidatePath("/app");
    revalidatePath(`/app/projects/${projectId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: userMessage(error, "Project setup could not be completed.") };
  }
}

export async function setProjectArchivedAction(
  projectId: string,
  archived: boolean,
): Promise<ProjectActionResult> {
  try {
    const user = await authenticatedUser();
    if (!UUID_PATTERN.test(projectId)) return { ok: false, error: "The project ID is invalid." };
    const supabase = await createClient();
    let statusUpdate = supabase
      .from("aido_writing_projects")
      .update({ status: archived ? "archived" : "active" })
      .eq("id", projectId)
      .eq("owner_id", user.id);
    if (archived) statusUpdate = statusUpdate.neq("status", "setup");
    const { data: updated, error } = await statusUpdate.select("id").maybeSingle();
    if (error) throw error;
    if (!updated) return { ok: false, error: "Finish setup before archiving this project." };
    const { error: activityError } = await supabase.from("aido_project_activity").insert({
      project_id: projectId,
      actor_id: user.id,
      event_type: archived ? "project.archived" : "project.restored",
    });
    if (activityError) throw activityError;
    revalidatePath("/app");
    revalidatePath(`/app/projects/${projectId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: userMessage(error, "The project status could not be changed.") };
  }
}

export async function deleteProjectAction(projectId: string): Promise<ProjectActionResult> {
  try {
    const user = await authenticatedUser();
    if (!UUID_PATTERN.test(projectId)) return { ok: false, error: "The project ID is invalid." };
    const supabase = await createClient();
    const projectFolder = `${user.id}/${projectId}`;
    const { data: storedFiles, error: listError } = await supabase.storage
      .from(ASSIGNMENT_FILE_BUCKET)
      .list(projectFolder, { limit: 1000 });
    if (listError) throw listError;
    const paths = storedFiles.map((file) => `${projectFolder}/${file.name}`);
    if (paths.length) {
      const { error: storageError } = await supabase.storage
        .from(ASSIGNMENT_FILE_BUCKET)
        .remove(paths);
      if (storageError) throw storageError;
    }

    const { error } = await supabase.rpc("aido_delete_project", { p_project_id: projectId });
    if (error?.code === "PGRST202") {
      const { error: fallbackError } = await supabase
        .from("aido_writing_projects")
        .delete()
        .eq("id", projectId)
        .eq("owner_id", user.id);
      if (fallbackError) throw fallbackError;
    } else if (error) {
      throw error;
    }
    revalidatePath("/app");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: userMessage(error, "The project could not be deleted.") };
  }
}
