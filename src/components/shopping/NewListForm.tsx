"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function NewListForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const response = await fetch("/api/shopping-lists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    setBusy(false);
    if (response.ok) {
      const body = (await response.json()) as { id: string };
      router.push(`/shopping-lists/${body.id}`);
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex gap-2">
      <label htmlFor="new-list-name" className="sr-only">
        New list name
      </label>
      <input
        id="new-list-name"
        className="input max-w-xs"
        placeholder="New list name…"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={120}
      />
      <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>
        Create
      </button>
    </form>
  );
}
