"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function SetupForm() {
  const router = useRouter();
  const [token, setToken] = useState("");
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
    const response = await fetch("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, username, displayName, password }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setBusy(false);
      setError(body?.error ?? "Setup failed.");
      return;
    }
    // Auto sign-in as the freshly created owner.
    const signInResult = await signIn("credentials", { username, password, redirect: false });
    setBusy(false);
    if (signInResult?.error) {
      router.push("/login");
    } else {
      router.push("/");
    }
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit} className="card flex flex-col gap-4 p-6">
      <div>
        <label htmlFor="setup-token" className="label">
          Setup token
        </label>
        <input id="setup-token" className="input" required value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
      </div>
      <div>
        <label htmlFor="setup-username" className="label">
          Username
        </label>
        <input id="setup-username" className="input" required minLength={3} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
      </div>
      <div>
        <label htmlFor="setup-display-name" className="label">
          Display name
        </label>
        <input id="setup-display-name" className="input" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" />
      </div>
      <div>
        <label htmlFor="setup-password" className="label">
          Password (min 10 characters)
        </label>
        <input id="setup-password" type="password" className="input" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </div>
      <div>
        <label htmlFor="setup-confirm" className="label">
          Confirm password
        </label>
        <input id="setup-confirm" type="password" className="input" required minLength={10} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? "Creating owner…" : "Create owner account"}
      </button>
    </form>
  );
}
