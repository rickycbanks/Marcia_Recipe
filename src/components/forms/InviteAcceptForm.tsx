"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function InviteAcceptForm({ invitationId, secret }: { invitationId: string; secret: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    const response = await fetch("/api/invitations/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invitationId, secret, username, displayName, password }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setBusy(false);
      setError(body?.error ?? "Could not accept the invitation.");
      return;
    }
    const signInResult = await signIn("credentials", { username, password, redirect: false });
    setBusy(false);
    router.push(signInResult?.error ? "/login" : "/");
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit} className="card flex flex-col gap-4 p-6">
      <div>
        <label htmlFor="invite-username" className="label">
          Username
        </label>
        <input id="invite-username" className="input" required minLength={3} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
      </div>
      <div>
        <label htmlFor="invite-display-name" className="label">
          Display name
        </label>
        <input id="invite-display-name" className="input" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" />
      </div>
      <div>
        <label htmlFor="invite-password" className="label">
          Password (min 10 characters)
        </label>
        <input id="invite-password" type="password" className="input" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </div>
      <div>
        <label htmlFor="invite-confirm" className="label">
          Confirm password
        </label>
        <input id="invite-confirm" type="password" className="input" required minLength={10} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? "Creating account…" : "Accept invitation"}
      </button>
    </form>
  );
}
