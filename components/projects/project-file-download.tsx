"use client";

import { useState, useTransition } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ASSIGNMENT_FILE_BUCKET } from "@/lib/projects/config";

export function ProjectFileDownload({ path, filename }: { path: string; filename: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function download() {
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const { data, error: downloadError } = await supabase.storage
        .from(ASSIGNMENT_FILE_BUCKET)
        .download(path);
      if (downloadError || !data) {
        setError("Download failed.");
        return;
      }
      const url = URL.createObjectURL(data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <div className="file-download">
      <button type="button" aria-label={`Download ${filename}`} disabled={isPending} onClick={download}>
        {isPending ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}
      </button>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
