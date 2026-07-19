// filepath: app/app/layout.tsx
import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { requireAuthOrRedirect } from "@/lib/auth/actions";
import { listProjects } from "@/lib/projects/queries";
import "./workspace.css";

export const metadata: Metadata = {
  title: "Workspace",
  description: "AidoFor.me assignment and research workspace.",
  robots: { index: false, follow: false },
};

// Authenticated workspace routes. requireAuthOrRedirect() bounces
// unauthenticated requests to /login?next=<this path>; the proxy adds
// the same gate one layer up. Both run because the route is rendered
// dynamically when the proxy refreshes the session cookie.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await requireAuthOrRedirect("/app");
  const projects = await listProjects("active");
  return <AppShell user={auth} projects={projects}>{children}</AppShell>;
}
