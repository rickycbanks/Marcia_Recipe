"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface BackupInfo {
  fileName: string;
  bytes: number;
  createdAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function BackupsPanel({ backups }: { backups: BackupInfo[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/backups", { method: "POST" });
    setBusy(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Backup failed.");
    }
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <button type="button" className="btn-primary" onClick={create} disabled={busy}>
          {busy ? "Creating archive…" : "Create backup now"}
        </button>
        {error ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Archive</th>
              <th className="px-4 py-3 font-medium">Size</th>
              <th className="px-4 py-3 text-right font-medium">Download</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {backups.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                  No backups yet.
                </td>
              </tr>
            ) : (
              backups.map((backup) => (
                <tr key={backup.fileName}>
                  <td className="px-4 py-2.5 font-mono text-xs">{backup.fileName}</td>
                  <td className="px-4 py-2.5">{formatBytes(backup.bytes)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <a href={`/api/backups/${backup.fileName}`} className="btn-secondary px-2 py-1 text-xs" download>
                      Download
                    </a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Restore from the command line: <code>npm run cli:restore -- --file &lt;archive&gt; [--dry-run] [--force]</code>
      </p>
    </div>
  );
}
