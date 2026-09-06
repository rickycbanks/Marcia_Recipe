"use client";

import { useEffect, useRef, useState } from "react";
import { PhotoPicker } from "./PhotoPicker";

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
  onBusyChange: (busy: boolean) => void;
  disabled?: boolean;
  onItemsChange: (items: StagedMediaItem[]) => void;
  onDirty: () => void;
}

export function StagedMediaManager({ onItemsChange, onDirty, onBusyChange, disabled }: Props) {
  const itemsRef = useRef<LocalStagedMediaItem[]>([]);
  const [items, setItems] = useState<LocalStagedMediaItem[]>([]);
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

  const upload = async (file: File, alt: string) => {
    const form = new FormData();
    form.set("file", file);
    form.set("alt", alt);
    const response = await fetch("/api/recipes/media/stage", { method: "POST", body: form });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Upload failed. Please try again.");
    }
    const body = (await response.json()) as { media: StagedMediaItem };
    const next = [...itemsRef.current, { ...body.media, previewUrl: URL.createObjectURL(file) }];
    itemsRef.current = next;
    setItems(next);
    onItemsChange(next);
    onDirty();
  };

  const remove = async (item: LocalStagedMediaItem) => {
    if (!window.confirm("Remove this image?")) return;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      const response = await fetch(`/api/recipes/media/stage/${item.id}`, { method: "DELETE" });
      if (!response.ok) {
        setError("Could not remove the image.");
        return;
      }
      URL.revokeObjectURL(item.previewUrl);
      const next = itemsRef.current.filter((currentItem) => currentItem.id !== item.id);
      itemsRef.current = next;
      setItems(next);
      onItemsChange(next);
      onDirty();
    } catch {
      setError("Could not remove the image.");
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };

  return (
    <div id="photos" className="card min-w-0 flex scroll-mt-24 flex-col gap-3 p-4">
      <h3 className="font-display text-lg font-semibold">Photos</h3>
      {items.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
                className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded bg-danger text-lg font-semibold text-danger-foreground focus:opacity-100"
                onClick={() => remove(item)}
                disabled={busy || disabled}
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
      <PhotoPicker disabled={busy || disabled} onUpload={upload} onBusyChange={(value) => { setBusy(value); onBusyChange(value); }} />
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
