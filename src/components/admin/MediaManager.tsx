"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PhotoPicker } from "./PhotoPicker";

interface MediaItemData {
  id: string;
  alt: string;
  isPrimary: boolean;
}

interface Props {
  onBusyChange: (busy: boolean) => void;
  disabled?: boolean;
  recipeId: string;
  media: MediaItemData[];
}

export function MediaManager({ recipeId, media, onBusyChange, disabled }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File, alt: string) => {
    const form = new FormData();
    form.set("file", file);
    form.set("alt", alt);
    const response = await fetch(`/api/recipes/${recipeId}/media`, { method: "POST", body: form });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Upload failed. Please try again.");
    }
    router.refresh();
  };

  const remove = async (mediaId: string) => {
    if (!window.confirm("Remove this image?")) return;
    setBusy(true);
    setError(null);
    onBusyChange(true);
    try {
      const response = await fetch(`/api/recipes/${recipeId}/media/${mediaId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not remove the image.");
      router.refresh();
    } catch {
      setError("Could not remove the image. Please try again.");
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };

  return (
    <div id="photos" className="card min-w-0 flex scroll-mt-24 flex-col gap-3 p-4">
      <h3 className="font-display text-lg font-semibold">Photos</h3>
      {media.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
                className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded bg-danger text-lg font-semibold text-danger-foreground"
                onClick={() => remove(item.id)}
                disabled={busy || disabled}
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
      <PhotoPicker disabled={busy || disabled} onUpload={upload} onBusyChange={(value) => { setBusy(value); onBusyChange(value); }} />
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
