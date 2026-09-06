"use client";

import { useId, useRef, useState } from "react";
import { MEDIA_LIMITS } from "@/lib/validation/constants";

interface Props {
  disabled?: boolean;
  onUpload: (file: File, alt: string) => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}

/** Upload in selection order, keeping successful photos if another file fails. */
export function PhotoPicker({ disabled, onUpload, onBusyChange }: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const uploading = useRef(false);
  const [alt, setAlt] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function upload(files: File[]) {
    if (!files.length || uploading.current) return;
    uploading.current = true;
    onBusyChange(true);
    setErrors([]);
    let added = 0;
    const failures: string[] = [];
    try {
      for (const [index, file] of files.entries()) {
        setProgress(`Adding photo ${index + 1} of ${files.length}…`);
        try {
          if (file.size > MEDIA_LIMITS.maxUploadBytes) throw new Error("Choose a photo smaller than 10 MB.");
          await onUpload(file, alt);
          added++;
        } catch (error) {
          failures.push(`${file.name}: ${error instanceof Error ? error.message : "Upload failed. Please try again."}`);
          setErrors([...failures]);
        }
      }
      setProgress(`${added} photo${added === 1 ? "" : "s"} added.${failures.length ? " Select the failed photos again to retry." : ""}`);
      if (!failures.length) setAlt("");
    } finally {
      uploading.current = false;
      onBusyChange(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col items-start gap-3">
      <div className="w-full">
        <label htmlFor={`${id}-alt`} className="label">Photo description (optional)</label>
        <input id={`${id}-alt`} className="input" value={alt} onChange={(event) => setAlt(event.target.value)} maxLength={200} disabled={disabled} placeholder="e.g., Freshly baked apple pie" />
      </div>
      <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif,image/tiff" className="hidden" aria-label="Choose photos" disabled={disabled} onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = "";
        void upload(files);
      }} />
      <button type="button" className="btn-primary min-h-11 w-full sm:w-auto" disabled={disabled} onClick={() => input.current?.click()}>
        {disabled ? "Working…" : "+ Choose photos"}
      </button>
      <p className="help-text">Select one or more photos. They upload automatically. JPEG, PNG, WebP, AVIF or TIFF; up to 10 MB each.</p>
      {progress ? <p role="status" className="text-sm">{progress}</p> : null}
      {errors.length ? <ul role="alert" className="w-full space-y-1 text-sm text-danger [overflow-wrap:anywhere]">{errors.map((error, index) => <li key={index}>{error}</li>)}</ul> : null}
    </div>
  );
}
