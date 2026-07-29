"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const ASSIGNABLE = ["recipes.read", "mealPlans.use", "shoppingLists.use"] as const;
const DEPENDENCIES: Record<string, string[]> = {
  "mealPlans.use": ["recipes.read"],
  "shoppingLists.use": ["recipes.read"],
};

interface InvitationRow {
  id: string;
  capabilities: string[];
  expiresAt: string;
  status: "pending" | "accepted" | "cancelled";
  issuedAt: string;
}

export function InvitationsAdmin({ invitations }: { invitations: InvitationRow[] }) {
  const router = useRouter();
  const [capabilities, setCapabilities] = useState<string[]>(["recipes.read"]);
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (cap: string) => {
    setCapabilities((current) => {
      const next = new Set(current);
      if (next.has(cap)) {
        next.delete(cap);
        for (const [dependent, deps] of Object.entries(DEPENDENCIES)) {
          if (deps.includes(cap)) next.delete(dependent);
        }
      } else {
        next.add(cap);
        for (const dep of DEPENDENCIES[cap] ?? []) next.add(dep);
      }
      return [...next];
    });
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    setCreatedUrl(null);
    const response = await fetch("/api/invitations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capabilities, expiresInDays }),
    });
    setBusy(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Could not create the invitation.");
      return;
    }
    const body = (await response.json()) as { url: string };
    setCreatedUrl(`${window.location.origin}${body.url}`);
    router.refresh();
  };

  const cancel = async (id: string) => {
    setBusy(true);
    setError(null);
    await fetch(`/api/invitations/${id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="card flex flex-col gap-4 p-6" aria-label="Create invitation">
        <h2 className="font-display text-xl font-semibold">New invitation</h2>
        <div className="flex flex-wrap gap-4">
          <fieldset>
            <legend className="label">Capabilities</legend>
            <div className="flex flex-wrap gap-3">
              {ASSIGNABLE.map((cap) => (
                <label key={cap} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={capabilities.includes(cap)} onChange={() => toggle(cap)} />
                  {cap}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="expires" className="label">
              Expires in
            </label>
            <select id="expires" className="input w-auto" value={expiresInDays} onChange={(e) => setExpiresInDays(Number(e.target.value))}>
              {[1, 3, 7, 14, 30].map((d) => (
                <option key={d} value={d}>
                  {d} day{d > 1 ? "s" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button type="button" className="btn-primary self-start" onClick={create} disabled={busy || capabilities.length === 0}>
          {busy ? "Creating…" : "Create invitation"}
        </button>
        {createdUrl ? (
          <div className="rounded-lg border border-accent bg-muted p-3">
            <p className="mb-1 text-sm font-medium">Share this link now — it&apos;s shown only once:</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="break-all rounded bg-card px-2 py-1 text-xs">{createdUrl}</code>
              <button
                type="button"
                className="btn-secondary px-2 py-1 text-xs"
                onClick={() => {
                  void navigator.clipboard.writeText(createdUrl).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  });
                }}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </section>

      <section className="card overflow-x-auto" aria-label="Invitation history">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Issued</th>
              <th className="px-4 py-3 font-medium">Capabilities</th>
              <th className="px-4 py-3 font-medium">Expires</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {invitations.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No invitations yet.
                </td>
              </tr>
            ) : (
              invitations.map((inv) => (
                <tr key={inv.id}>
                  <td className="px-4 py-2.5">{new Date(inv.issuedAt).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5 text-xs">{inv.capabilities.join(", ")}</td>
                  <td className="px-4 py-2.5">{new Date(inv.expiresAt).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5">
                    <span className="badge">{inv.status}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {inv.status === "pending" ? (
                      <button type="button" className="btn-danger px-2 py-1 text-xs" disabled={busy} onClick={() => cancel(inv.id)}>
                        Cancel
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
