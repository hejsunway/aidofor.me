import { createClient } from "@/lib/supabase/server";
import type {
  AidoAssignmentDocument,
  AidoProjectActivity,
  AidoProjectStatus,
  AidoWritingProject,
} from "@/lib/supabase/types";

export type ProjectListItem = AidoWritingProject & {
  documentCount: number;
  hasBrief: boolean;
  hasRubric: boolean;
};

export async function listProjects(status: Exclude<AidoProjectStatus, "setup">): Promise<ProjectListItem[]> {
  const supabase = await createClient();
  let query = supabase
    .from("aido_writing_projects")
    .select("*")
    .order("updated_at", { ascending: false });
  query = status === "active" ? query.in("status", ["setup", "active"]) : query.eq("status", "archived");
  const { data: projects, error } = await query;
  if (error) throw new Error("Projects could not be loaded.");
  if (!projects.length) return [];

  const projectIds = projects.map((project) => project.id);
  const { data: documents, error: documentError } = await supabase
    .from("aido_assignment_documents")
    .select("*")
    .in("project_id", projectIds);
  if (documentError) throw new Error("Project files could not be loaded.");

  return projects.map((project) => {
    const projectDocuments = documents.filter((document) =>
      document.project_id === project.id && document.replaced_at == null
    );
    return {
      ...project,
      documentCount: projectDocuments.length,
      hasBrief: projectDocuments.some((document) => document.kind === "brief"),
      hasRubric: projectDocuments.some((document) => document.kind === "rubric"),
    };
  });
}

export async function getProject(projectId: string): Promise<{
  project: AidoWritingProject;
  documents: AidoAssignmentDocument[];
  activity: AidoProjectActivity[];
  phaseOneCompletionAvailable: boolean;
} | null> {
  const supabase = await createClient();
  const { data: project, error } = await supabase
    .from("aido_writing_projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new Error("The project could not be loaded.");
  if (!project) return null;

  const [documentsResult, activityResult, policyResult] = await Promise.all([
    supabase
      .from("aido_assignment_documents")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
    supabase
      .from("aido_project_activity")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("aido_project_policies")
      .select("project_id")
      .eq("project_id", projectId)
      .maybeSingle(),
  ]);
  if (documentsResult.error || activityResult.error) {
    throw new Error("Project details could not be loaded.");
  }

  return {
    project,
    documents: documentsResult.data.filter((document) => document.replaced_at == null),
    activity: activityResult.data,
    phaseOneCompletionAvailable: !policyResult.error,
  };
}
