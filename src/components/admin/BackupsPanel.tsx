"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { signOut } from "next-auth/react";

interface BackupInfo {
  fileName: string;
  bytes: number;
  createdAt: string;
}

interface RestoreResult {
  safetyBackup?: { fileName: string; bytes: number; createdAt: string };
  restored?: boolean;
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
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);

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

  const restore = async () => {
    if (!restoreFile || !window.confirm("Restore this archive and replace the current site data? This cannot be undone.")) return;
    setBusy(true);
    setError(null);
    setRestoreResult(null);
    const form = new FormData();
    form.set("file", restoreFile);
    form.set("force", String(replaceExisting));
    const response = await fetch("/api/backups/restore", { method: "POST", body: form });
    setBusy(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Restore failed.");
      return;
    }
    const body = (await response.json().catch(() => null)) as { restore?: RestoreResult } | null;
    setRestoreFile(null);
    setRestoreResult(body?.restore ?? {});
  };

  const finishRestore = async () => {
    setBusy(true);
    await signOut({ redirect: false });
    router.push("/login");
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
      <section className="card border-danger p-5" aria-labelledby="restore-heading">
        <h2 id="restore-heading" className="font-display text-lg font-semibold text-danger">Restore backup</h2>
        <p className="mt-1 text-sm text-muted-foreground">Dangerous action: restoring replaces the current site data. A fresh safety backup is created first.</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Restoring replaces all site data. Every account session ends — you will be signed out and asked to sign in again.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="sr-only" htmlFor="restore-file">Backup archive</label>
          <input id="restore-file" type="file" accept=".tar.gz,application/gzip" onChange={(event) => setRestoreFile(event.target.files?.[0] ?? null)} disabled={busy} className="input max-w-sm text-sm" />
          <button type="button" className="btn-danger" onClick={restore} disabled={busy || !restoreFile}>{busy ? "Restoring…" : "Restore selected backup"}</button>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={replaceExisting}
            onChange={(event) => setReplaceExisting(event.target.checked)}
            disabled={busy}
          />
          Replace existing data
        </label>
        {restoreResult ? (
          <div className="mt-4 rounded border border-border p-4">
            <h3 className="font-semibold">Restore complete</h3>
            {restoreResult.safetyBackup ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Safety backup saved: <span className="font-mono text-xs">{restoreResult.safetyBackup.fileName}</span>. You will be signed out.
              </p>
            ) : null}
            <button type="button" className="btn-primary mt-3" onClick={finishRestore} disabled={busy}>
              {busy ? "Signing out…" : "Sign out and continue"}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
