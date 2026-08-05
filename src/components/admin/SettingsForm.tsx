"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

interface Settings {
  siteName: string;
  defaultVisibility: "public" | "members";
  theme: "editorial" | "warm" | "ocean" | "minimal" | "purple" | "turquoise" | "dusty-rose";
}

export function SettingsForm({ initial }: { initial: Settings }) {
  const router = useRouter();
  const [form, setForm] = useState<Settings>(initial);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Could not save settings.");
      return;
    }
    setStatus("Settings saved.");
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit} className="card flex flex-col gap-4 p-6">
      <div>
        <label htmlFor="siteName" className="label">
          Site name
        </label>
        <input id="siteName" className="input" required maxLength={80} value={form.siteName} onChange={(e) => setForm({ ...form, siteName: e.target.value })} />
      </div>
      <div>
        <label htmlFor="defaultVisibility" className="label">
          Default recipe visibility (applies to recipes set to “inherit”)
        </label>
        <select
          id="defaultVisibility"
          className="input"
          value={form.defaultVisibility}
          onChange={(e) => setForm({ ...form, defaultVisibility: e.target.value as Settings["defaultVisibility"] })}
        >
          <option value="public">Public — visible to everyone</option>
          <option value="members">Members — requires an account with recipes.read</option>
        </select>
      </div>
      <div>
        <label htmlFor="theme" className="label">
          Theme (applies site-wide on save)
        </label>
        <select id="theme" className="input" value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value as Settings["theme"] })}>
          <option value="editorial">Editorial</option>
          <option value="warm">Warm</option>
          <option value="ocean">Ocean</option>
          <option value="minimal">Minimal</option>
          <option value="purple">Purple</option>
          <option value="turquoise">Turquoise</option>
          <option value="dusty-rose">Dusty Rose</option>
        </select>
      </div>
      {status ? <p className="text-sm text-accent">{status}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn-primary self-start" disabled={busy}>
        {busy ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
