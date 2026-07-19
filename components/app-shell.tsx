// filepath: components/app-shell.tsx
import Link from "next/link";
import {
  LogOut,
  Menu,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { BrandLogo } from "./brand-logo";
import { WorkspaceNavigation } from "./workspace-navigation";
import { signOutAction } from "@/lib/auth/actions";
import type { AidoProjectStatus } from "@/lib/supabase/types";

type SidebarProject = {
  id: string;
  title: string;
  status: AidoProjectStatus;
};

type AppShellProps = {
  children: React.ReactNode;
  user: { id: string; email: string };
  projects: SidebarProject[];
};

function initials(email: string): string {
  const local = email.split("@")[0] ?? "";
  const first = local[0] ?? "";
  return (first + (local[1] ?? "")).toUpperCase() || "A";
}

export function AppShell({ children, user, projects }: AppShellProps) {
  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar">
        <div className="workspace-sidebar__brand">
          <BrandLogo compact href="/app" />
          <Link href="/app/new" aria-label="Create new assignment"><Plus size={16} /></Link>
        </div>
        <WorkspaceNavigation projects={projects} />
        <div className="workspace-sidebar__footer">
          <div className="workspace-private"><ShieldCheck size={15} /><span>Private by default</span></div>
          <details className="workspace-account">
            <summary aria-label={`Open account menu for ${user.email}`}>
              <span className="workspace-avatar">{initials(user.email)}</span>
              <span className="workspace-account__identity"><b>{user.email}</b><small>Student account</small></span>
            </summary>
            <div className="workspace-account__menu">
              <form action={signOutAction}>
                <button type="submit"><LogOut size={15} aria-hidden="true" />Sign out</button>
              </form>
            </div>
          </details>
        </div>
      </aside>

      <header className="workspace-mobile-header">
        <BrandLogo compact href="/app" />
        <details className="workspace-mobile-menu">
          <summary aria-label="Open workspace navigation"><Menu size={19} /></summary>
          <div>
            <WorkspaceNavigation projects={projects} />
            <form action={signOutAction}>
              <button type="submit"><LogOut size={15} />Sign out</button>
            </form>
          </div>
        </details>
      </header>
      <div className="workspace-main">{children}</div>
    </div>
  );
}
