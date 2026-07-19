import type {
  AidoDocumentKind,
  AidoIntegrityMode,
} from "@/lib/supabase/types";

export const ASSIGNMENT_FILE_BUCKET = "aido-assignment-files";
export const MAX_ASSIGNMENT_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_PROJECT_FILE_COUNT = 12;
export const MAX_ARCHIVE_ENTRY_COUNT = 2_000;
export const MAX_ARCHIVE_EXPANDED_BYTES = 100 * 1024 * 1024;
export const MAX_ARCHIVE_COMPRESSION_RATIO = 100;
export const ACCEPTED_ASSIGNMENT_FILES = ".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt";

export const ASSIGNMENT_TYPES = [
  "Analytical essay",
  "Case study",
  "Literature review",
  "Research proposal",
  "Report",
  "Reflective writing",
] as const;

export const CITATION_STYLES = [
  "APA 7",
  "Harvard",
  "MLA 9",
  "Chicago author-date",
  "IEEE",
] as const;

export const INTEGRITY_MODES: ReadonlyArray<{
  value: AidoIntegrityMode;
  name: string;
  shortName: string;
  description: string;
  recommended?: boolean;
}> = [
  {
    value: "unknown",
    name: "Unknown",
    shortName: "Policy not confirmed",
    description: "Planning is available. Drafting stays locked until the policy is confirmed.",
    recommended: true,
  },
  {
    value: "planning_only",
    name: "Planning only",
    shortName: "Planning only",
    description: "Use Aido for requirements, research, sources, and outline suggestions.",
  },
  {
    value: "assistive_writing",
    name: "Assistive writing",
    shortName: "Assistive writing allowed",
    description: "Use evidence-grounded writing help where your course permits it.",
  },
  {
    value: "no_ai",
    name: "No AI permitted",
    shortName: "No AI permitted",
    description: "Keep the workspace to manual planning, sources, and citation formatting.",
  },
  {
    value: "open_required_ai",
    name: "AI use is open or required",
    shortName: "Open AI use",
    description: "Use AI within the stated course rules and keep decisions traceable.",
  },
];

export const FILE_MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  txt: "text/plain",
};

export function fileExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

export function normalizedMimeType(filename: string): string | null {
  return FILE_MIME_BY_EXTENSION[fileExtension(filename)] ?? null;
}

export function safeStorageFilename(filename: string): string {
  const extension = fileExtension(filename);
  const stem = filename.slice(0, Math.max(0, filename.length - extension.length - 1));
  const safeStem = stem
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "assignment-file";
  return extension ? `${safeStem}.${extension}` : safeStem;
}

export function validateAssignmentFile(file: File): string | null {
  if (!file.name || !normalizedMimeType(file.name)) {
    return "Choose a PDF, Word document, PNG, JPEG, or text file.";
  }
  if (file.size < 1) return "The selected file is empty.";
  if (file.size > MAX_ASSIGNMENT_FILE_BYTES) return "The file must be 25 MB or smaller.";
  return null;
}

export function isDocumentKind(value: string): value is AidoDocumentKind {
  return ["brief", "rubric", "policy", "template", "source", "other"].includes(value);
}

export function integrityModeLabel(mode: AidoIntegrityMode): string {
  return INTEGRITY_MODES.find((item) => item.value === mode)?.shortName ?? "Policy not confirmed";
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatProjectDate(value: string | null): string {
  if (!value) return "No deadline";
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}
