"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Archive, Files, SquarePen, WalletCards } from "lucide-react";
import type { AidoProjectStatus } from "@/lib/supabase/types";

type SidebarProject = {
  id: string;
  title: string;
  status: AidoProjectStatus;
};

export function WorkspaceNavigation({ projects }: { projects: SidebarProject[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const archived = pathname === "/app" && searchParams.get("view") === "archived";
  const projectId = pathname.match(/^\/app\/projects\/([^/]+)$/)?.[1];

  return (
    <>
      <nav className="workspace-primary-nav" aria-label="Workspace navigation">
        <Link
          className="workspace-nav-item workspace-nav-item--new"
          href="/app/new"
          aria-current={pathname === "/app/new" ? "page" : undefined}
        >
          <SquarePen size={18} aria-hidden="true" />
          <span>New assignment</span>
        </Link>
        <Link
          className="workspace-nav-item"
          href="/app"
          aria-current={pathname === "/app" && !archived ? "page" : undefined}
        >
          <Files size={18} aria-hidden="true" />
          <span>Assignments</span>
        </Link>
        <Link
          className="workspace-nav-item"
          href="/app?view=archived"
          aria-current={archived ? "page" : undefined}
        >
          <Archive size={18} aria-hidden="true" />
          <span>Archive</span>
        </Link>
        <Link
          className="workspace-nav-item"
          href="/app/billing"
          aria-current={pathname === "/app/billing" ? "page" : undefined}
        >
          <WalletCards size={18} aria-hidden="true" />
          <span>Credits</span>
        </Link>
      </nav>

      <section className="workspace-recents" aria-labelledby="recent-projects-title">
        <h2 id="recent-projects-title">Recent</h2>
        {projects.length ? (
          <nav aria-label="Recent assignments">
            {projects.slice(0, 8).map((project) => (
              <Link
                href={`/app/projects/${project.id}`}
                key={project.id}
                aria-current={projectId === project.id ? "page" : undefined}
              >
                <i className={`project-dot project-dot--${project.status}`} />
                <span>{project.title}</span>
              </Link>
            ))}
          </nav>
        ) : (
          <p>Your assignments will appear here.</p>
        )}
      </section>
    </>
  );
}
