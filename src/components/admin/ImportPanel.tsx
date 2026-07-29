"use client";

import { useRef, useState } from "react";

/**
 * Owner import panel:
 * - URL import: server fetches SSRF-safely and returns a DRAFT (never saves)
 * - OCR: Tesseract.js runs entirely in the browser; recognized text is parsed
 *   into a draft for review. Nothing is persisted until the owner saves.
 */
export interface ImportedDraft {
  title: string;
  description: string;
  prepMinutes: number | null;
  cookMinutes: number | null;
  servings: number | null;
  category: string | null;
  tags: string[];
  sourceUrl: string | null;
  ingredients: { quantity: number | null; unit: string | null; name: string; note: string | null }[];
  steps: string[];
  notesMarkdown: string;
}

interface Props {
  onImport: (draft: ImportedDraft) => void;
}

export function ImportPanel({ onImport }: Props) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const importFromUrl = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    setStatus("Fetching and parsing (this can take a few seconds)…");
    try {
      const response = await fetch("/api/import/url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const body = (await response.json().catch(() => null)) as
        | ({ draft: ImportedDraft; strategy: string } & { error?: string })
        | null;
      if (!response.ok || !body || !("draft" in body)) {
        setError(body?.error ?? "Import failed.");
        setStatus(null);
        return;
      }
      onImport(body.draft);
      setStatus(`Imported via ${body.strategy}. Review below, then save.`);
    } catch {
      setError("Import failed.");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  };

  const recognizeImage = async (file: File) => {
    setBusy(true);
    setError(null);
    setStatus("Recognizing text in your browser…");
    try {
      // Lazy-load Tesseract.js so it never affects server or page weight up front.
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng");
      const {
        data: { text },
      } = await worker.recognize(file);
      await worker.terminate();
      if (!text.trim()) {
        setError("No text could be recognized in that image.");
        setStatus(null);
        return;
      }
      setStatus("Parsing recognized text…");
      const response = await fetch("/api/import/ocr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body = (await response.json().catch(() => null)) as { draft?: ImportedDraft; error?: string } | null;
      if (!response.ok || !body?.draft) {
        setError(body?.error ?? "Could not parse the recognized text.");
        setStatus(null);
        return;
      }
      onImport(body.draft);
      setStatus("OCR draft loaded. Review below, then save.");
    } catch {
      setError("OCR failed. The image may be unreadable — server data was not affected.");
      setStatus(null);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <details className="card p-4">
      <summary className="cursor-pointer font-display text-lg font-semibold">Import a recipe</summary>
      <div className="mt-4 flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <label htmlFor="import-url" className="sr-only">
            Recipe URL
          </label>
          <input
            id="import-url"
            className="input flex-1"
            type="url"
            placeholder="https://example.com/their-recipe"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button type="button" className="btn-secondary" onClick={importFromUrl} disabled={busy || !url.trim()}>
            Import from URL
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="ocr-file" className="text-sm text-muted-foreground">
            Or scan a photo of a recipe (OCR runs locally in your browser):
          </label>
          <input
            id="ocr-file"
            ref={fileRef}
            type="file"
            accept="image/*"
            className="text-sm"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void recognizeImage(file);
            }}
          />
        </div>
        {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}
