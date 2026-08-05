"use client";

import { useEffect, useRef, useState } from "react";
import { preprocessImageForOcr } from "@/lib/imports/preprocess";
import { OCR_LIMITS } from "@/lib/validation/constants";

/**
 * Owner import panel:
 * - URL import: server fetches SSRF-safely and returns a DRAFT (never saves)
 * - OCR is handled by the server when configured. Recognized text is parsed into a
 *   draft for review. Nothing is persisted until the owner saves.
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

type OcrEngine = "tesseract" | "mistral";

interface Props {
  onImport: (draft: ImportedDraft) => void;
}

export function ImportPanel({ onImport }: Props) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Browser OCR remains in the source for compatibility, but is not exposed.
  const [ocrEngine] = useState<OcrEngine>("mistral");
  const [mistralEnabled, setMistralEnabled] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/import/ocr")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { mistralEnabled?: unknown } | null) => {
        if (!cancelled && body && typeof body.mistralEnabled === "boolean") {
          setMistralEnabled(body.mistralEnabled);
        }
      })
      .catch(() => {
        // Keep the explicit unavailable state when server OCR cannot be checked.
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    setStatus("Preparing image…");
    let worker: Awaited<ReturnType<typeof import("tesseract.js").createWorker>> | null = null;
    try {
      // Preprocess in-browser (upscale + border + grayscale) for much better
      // accuracy. If the canvas pipeline fails, fall back to the raw File so
      // OCR still attempts recognition.
      let processed: Blob = file;
      try {
        processed = await preprocessImageForOcr(file);
      } catch (preprocessErr) {
        console.warn("Image preprocessing failed; using the raw image", preprocessErr);
      }

      // Lazy-load Tesseract.js so it never affects server or page weight up front.
      const { createWorker, PSM } = await import("tesseract.js");
      worker = await createWorker("eng", 1, {
        // tessdata_best gives the highest accuracy and is cached in IndexedDB
        // after the first load.
        langPath: "https://tessdata.projectnaptha.com/4.0.0_best",
        logger: (m) => {
          if (m.status === "recognizing text") {
            setStatus(`Recognizing text… ${Math.round((m.progress ?? 0) * 100)}%`);
          } else if (m.status === "loading language traineddata" || m.status === "loading tesseract core") {
            setStatus("Loading OCR engine…");
          }
        },
      });
      await worker.setParameters({
        // AUTO (3) lets Tesseract detect the column layout — recipe pages are
        // often two-column (ingredients left, steps right), which SINGLE_BLOCK
        // assumes away.
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: "1",
        user_defined_dpi: "300", // without this Tesseract assumes 70 DPI → garbage
      });

      const {
        data: { text },
      } = await worker.recognize(processed, { rotateAuto: true });
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
      if (worker) await worker.terminate().catch(() => undefined);
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const recognizeImageViaMistral = async (file: File) => {
    const allowed = OCR_LIMITS.allowedMimeTypes as readonly string[];
    if (!allowed.includes(file.type)) {
      setError("That image type isn't supported for server OCR. Use PNG, JPEG, or AVIF.");
      setStatus(null);
      return;
    }
    setBusy(true);
    setError(null);
    setStatus("Sending image to the server for recognition…");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/import/ocr/image", { method: "POST", body: form });
      const body = (await response.json().catch(() => null)) as { draft?: ImportedDraft; error?: string } | null;
      if (!response.ok || !body?.draft) {
        setError(body?.error ?? "Server OCR failed. Check that MISTRAL_API_KEY is set.");
        setStatus(null);
        return;
      }
      onImport(body.draft);
      setStatus("OCR draft loaded. Review below, then save.");
    } catch {
      setError("Server OCR failed. Check that MISTRAL_API_KEY is set.");
      setStatus(null);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleFileChange = (file: File | undefined) => {
    if (!file) return;
    if (ocrEngine === "mistral") void recognizeImageViaMistral(file);
    else void recognizeImage(file);
  };

  return (
    <div className="card flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-lg font-semibold">Import a recipe</h2>
        <p className="help-text">Paste a URL or scan a photo to pre-fill the form below. Review before saving.</p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch">
        <div className="flex flex-1 flex-col gap-2">
          <label htmlFor="import-url" className="label">
            Recipe URL
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="import-url"
              className="input min-w-0 flex-1"
              type="url"
              placeholder="https://example.com/their-recipe"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button type="button" className="btn-secondary" onClick={importFromUrl} disabled={busy || !url.trim()}>
              Import from URL
            </button>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-2 border-t border-border pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
          <label htmlFor="ocr-file" className="label">
            Scan a photo
          </label>
          <p className="text-sm font-medium">OCR</p>
          <input
            id="ocr-file"
            ref={fileRef}
            type="file"
            accept={ocrEngine === "mistral" ? OCR_LIMITS.allowedMimeTypes.join(",") : "image/*"}
            className="input text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm file:font-medium file:text-foreground"
            disabled={busy || !mistralEnabled}
            onChange={(e) => handleFileChange(e.target.files?.[0])}
          />
          <p className="help-text">
            {mistralEnabled ? "Upload a recipe photo for server OCR." : "OCR is currently unavailable. Ask the site owner to configure server OCR."}
          </p>
        </div>
      </div>

      {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
