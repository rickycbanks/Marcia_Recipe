"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

interface MediaItemData {
  id: string;
  alt: string;
  isPrimary: boolean;
}

interface Props {
  recipeId: string;
  media: MediaItemData[];
}

export function MediaManager({ recipeId, media }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [alt, setAlt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    form.set("alt", alt);
    const response = await fetch(`/api/recipes/${recipeId}/media`, { method: "POST", body: form });
    setBusy(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Upload failed.");
      return;
    }
    setAlt("");
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  };

  const remove = async (mediaId: string) => {
    if (!window.confirm("Remove this image?")) return;
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/recipes/${recipeId}/media/${mediaId}`, { method: "DELETE" });
    setBusy(false);
    if (!response.ok) setError("Could not remove the image.");
    router.refresh();
  };

  return (
    <div className="card flex flex-col gap-3 p-4">
      <h3 className="font-display text-lg font-semibold">Photos</h3>
      {media.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {media.map((item) => (
            <li key={item.id} className="group relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/media/${recipeId}/${item.id}`}
                alt={item.alt}
                className="h-24 w-full rounded-lg border border-border object-cover"
              />
              {item.isPrimary ? (
                <span className="absolute left-1 top-1 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground">
                  primary
                </span>
              ) : null}
              <button
                type="button"
                className="absolute right-1 top-1 rounded bg-danger px-1.5 py-0.5 text-[10px] font-semibold text-danger-foreground opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => remove(item.id)}
                aria-label={`Remove image ${item.alt}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No photos yet.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/tiff" className="text-sm" aria-label="Image file" />
        <input
          className="input max-w-xs flex-1"
          placeholder="Alt text"
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
          maxLength={200}
          aria-label="Alt text"
        />
        <button type="button" className="btn-secondary" onClick={upload} disabled={busy}>
          {busy ? "Working…" : "Upload"}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">JPEG/PNG/WebP/AVIF/TIFF, max 10 MB, resized to WebP.</p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
