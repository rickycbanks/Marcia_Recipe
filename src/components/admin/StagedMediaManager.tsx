"use client";

import { useEffect, useRef, useState } from "react";

export interface StagedMediaItem {
  id: string;
  fileName: string;
  alt: string;
  width: number;
  height: number;
  bytes: number;
  isPrimary: boolean;
  createdAt: string;
}

interface LocalStagedMediaItem extends StagedMediaItem {
  previewUrl: string;
}

interface Props {
  onItemsChange: (items: StagedMediaItem[]) => void;
  onDirty: () => void;
}

export function StagedMediaManager({ onItemsChange, onDirty }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<LocalStagedMediaItem[]>([]);
  const [items, setItems] = useState<LocalStagedMediaItem[]>([]);
  const [alt, setAlt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    return () => {
      itemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, []);

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose an image first.");
      return;
    }

    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    form.set("alt", alt);

    try {
      const response = await fetch("/api/recipes/media/stage", { method: "POST", body: form });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Upload failed.");
        return;
      }
      const body = (await response.json()) as { media: StagedMediaItem };
      const nextItem = { ...body.media, previewUrl: URL.createObjectURL(file) };
      const next = [...itemsRef.current, nextItem];
      setItems(next);
      onItemsChange(next);
      onDirty();
      setAlt("");
      if (fileRef.current) fileRef.current.value = "";
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: LocalStagedMediaItem) => {
    if (!window.confirm("Remove this image?")) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/recipes/media/stage/${item.id}`, { method: "DELETE" });
      if (!response.ok) {
        setError("Could not remove the image.");
        return;
      }
      URL.revokeObjectURL(item.previewUrl);
      const next = itemsRef.current.filter((currentItem) => currentItem.id !== item.id);
      setItems(next);
      onItemsChange(next);
      onDirty();
    } catch {
      setError("Could not remove the image.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="photos" className="card flex scroll-mt-24 flex-col gap-3 p-4">
      <h3 className="font-display text-lg font-semibold">Photos</h3>
      {items.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {items.map((item, index) => (
            <li key={item.id} className="group relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.previewUrl} alt={item.alt} className="h-24 w-full rounded-lg border border-border object-cover" />
              {index === 0 ? (
                <span className="absolute left-1 top-1 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground">
                  primary
                </span>
              ) : null}
              <button
                type="button"
                className="absolute right-1 top-1 rounded bg-danger px-1.5 py-0.5 text-[10px] font-semibold text-danger-foreground opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                onClick={() => remove(item)}
                disabled={busy}
                aria-label={`Remove image ${item.alt || item.fileName}`}
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
          onChange={(event) => setAlt(event.target.value)}
          maxLength={200}
          aria-label="Alt text for next upload"
        />
        <button type="button" className="btn-secondary" onClick={upload} disabled={busy} aria-label="Upload image">
          {busy ? "Working…" : "Upload"}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">JPEG/PNG/WebP/AVIF/TIFF, max 10 MB, resized to WebP.</p>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
