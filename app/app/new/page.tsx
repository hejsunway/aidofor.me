import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { NewProjectForm } from "@/components/projects/new-project-form";

export default function NewProjectPage() {
  return (
    <main className="app-content app-content--form">
      <Link className="back-link" href="/app"><ArrowLeft size={17} />Assignments</Link>
      <div className="project-setup-heading">
        <div><span>NEW ASSIGNMENT</span><h1>Set up the assignment</h1><p>Add the source files and course rules Aido should follow.</p></div>
      </div>
      <NewProjectForm />
    </main>
  );
}
