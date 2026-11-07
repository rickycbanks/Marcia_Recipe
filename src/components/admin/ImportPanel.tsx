import { useEffect, useRef, useState } from "react";
import { preprocessImageForOcr } from "@/lib/imports/preprocess";
import { OCR_LIMITS } from "@/lib/validation/constants";

/**
 * Owner import panel:
 * - URL import: server fetches SSRF-safely and returns a DRAFT (never saves)
 * - OCR is driven by the site-wide active provider (server-selected).
 *   Tesseract: browser-local recognition → server text parse.
 *   Cloud: page images sent to the generic server route/dispatcher.
 *   Clients cannot choose or force a provider.
 * - Photos stage as an ordered page list (thumbnail, reorder, remove) so a
 *   multi-page recipe scan can be arranged before recognition runs.
 */

export type OcrProvider = "tesseract" | "mistral" | "gemini";

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

interface OcrCapability {
  activeProvider: OcrProvider;
}

interface StagedPage {
  id: string;
  file: File;
  previewUrl: string;
}

interface Props {
  onImport: (draft: ImportedDraft) => void;
}

let stagedPageSeq = 0;

export function ImportPanel({ onImport }: Props) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ocrCapability, setOcrCapability] = useState<OcrCapability | null>(null);
  const [staged, setStaged] = useState<StagedPage[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const stagedRef = useRef<StagedPage[]>([]);

  const activeProvider = ocrCapability?.activeProvider ?? "tesseract";
  const isCloudProvider = activeProvider !== "tesseract";
  const ocrAvailable = true; // Tesseract is always available; cloud providers depend on config

  useEffect(() => {
    stagedRef.current = staged;
  }, [staged]);

  useEffect(() => {
    return () => {
      stagedRef.current.forEach((page) => URL.revokeObjectURL(page.previewUrl));
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/import/ocr")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: OcrCapability | null) => {
        if (!cancelled && body && typeof body.activeProvider === "string") {
          setOcrCapability(body);
        }
      })
      .catch(() => {
        // Default to tesseract if the capability check fails
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

  /** Stage selected photos as pages, enforcing the page-count limit. */
  const stageFiles = (files: File[]) => {
    if (files.length === 0) return;
    setError(null);
    setStatus(null);

    if (isCloudProvider) {
      const allowed = OCR_LIMITS.allowedMimeTypes as readonly string[];
      const badType = files.find((file) => !allowed.includes(file.type));
      if (badType) {
        setError("One of those photos isn't a type the server supports. Use PNG, JPEG, or AVIF.");
        return;
      }
      const tooBig = files.find((file) => file.size > OCR_LIMITS.maxImageBytes);
      if (tooBig) {
        setError("One of those photos exceeds the size limit.");
        return;
      }
    }

    const room = OCR_LIMITS.maxPages - staged.length;
    if (room <= 0) {
      setError(`You can scan at most ${OCR_LIMITS.maxPages} pages at once. Remove a page first.`);
      return;
    }
    if (files.length > room) {
      setError(`Only ${room} more page${room === 1 ? "" : "s"} can be added (max ${OCR_LIMITS.maxPages} pages).`);
    }

    const additions = files.slice(0, room).map((file) => ({
      id: `staged-page-${++stagedPageSeq}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setStaged((current) => [...current, ...additions]);
  };

  const movePage = (index: number, direction: -1 | 1) => {
    setStaged((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };

  const removePage = (id: string) => {
    setStaged((current) => {
      const page = current.find((item) => item.id === id);
      if (page) URL.revokeObjectURL(page.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  };

  /** Drop the staged pages and free their preview URLs. */
  const clearStaged = () => {
    stagedRef.current.forEach((page) => URL.revokeObjectURL(page.previewUrl));
    setStaged([]);
  };

  /** Browser-local Tesseract OCR: preprocess → recognize each page → send combined text to the server parser. */
  const recognizePagesLocal = async (pages: StagedPage[]) => {
    setBusy(true);
    setError(null);
    setStatus("Loading OCR engine…");
    let worker: Awaited<ReturnType<typeof import("tesseract.js").createWorker>> | null = null;
    try {
      const { createWorker, PSM } = await import("tesseract.js");
      worker = await createWorker("eng", 1, {
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
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
      });

      const pageTexts: string[] = [];
      for (const [index, page] of pages.entries()) {
        setStatus(`Preparing page ${index + 1} of ${pages.length}…`);
        let processed: Blob = page.file;
        try {
          processed = await preprocessImageForOcr(page.file);
        } catch (preprocessErr) {
          console.warn("Image preprocessing failed; using the raw image", preprocessErr);
        }
        setStatus(`Recognizing page ${index + 1} of ${pages.length}…`);
        const {
          data: { text },
        } = await worker.recognize(processed, { rotateAuto: true });
        if (text.trim()) pageTexts.push(text.trim());
      }

      if (pageTexts.length === 0) {
        setError("No text could be recognized in those images.");
        setStatus(null);
        return;
      }
      setStatus("Parsing recognized text…");
      const response = await fetch("/api/import/ocr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: pageTexts.join("\n\n") }),
      });
      const body = (await response.json().catch(() => null)) as { draft?: ImportedDraft; error?: string } | null;
      if (!response.ok || !body?.draft) {
        setError(body?.error ?? "Could not parse the recognized text.");
        setStatus(null);
        return;
      }
      onImport(body.draft);
      setStatus("OCR draft loaded. Review below, then save.");
      clearStaged();
    } catch {
      setError("OCR failed. The images may be unreadable — server data was not affected.");
      setStatus(null);
    } finally {
      if (worker) await worker.terminate().catch(() => undefined);
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /** Server-side cloud OCR: send all pages to the generic server route/dispatcher in one request. */
  const recognizePagesCloud = async (pages: StagedPage[]) => {
    setBusy(true);
    setError(null);
    setStatus(
      pages.length === 1
        ? "Sending the photo to the server for recognition…"
        : `Sending ${pages.length} photos to the server for recognition…`,
    );
    try {
      const form = new FormData();
      for (const page of pages) form.append("files", page.file);
      const response = await fetch("/api/import/ocr/image", { method: "POST", body: form });
      const body = (await response.json().catch(() => null)) as { draft?: ImportedDraft; error?: string } | null;
      if (!response.ok || !body?.draft) {
        setError(body?.error ?? "Server OCR failed. Check OCR provider settings in Admin Settings.");
        setStatus(null);
        return;
      }
      onImport(body.draft);
      setStatus("OCR draft loaded. Review below, then save.");
      clearStaged();
    } catch {
      setError("Server OCR failed. Check OCR provider settings in Admin Settings.");
      setStatus(null);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const recognizeStaged = () => {
    const pages = stagedRef.current;
    if (pages.length === 0) return;
    if (isCloudProvider) void recognizePagesCloud(pages);
    else void recognizePagesLocal(pages);
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
            Scan recipe pages
          </label>
          <p className="text-sm font-medium">OCR</p>
          <input
            id="ocr-file"
            ref={fileRef}
            type="file"
            multiple
            accept={isCloudProvider ? OCR_LIMITS.allowedMimeTypes.join(",") : "image/*"}
            className="input text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm file:font-medium file:text-foreground"
            disabled={busy || !ocrAvailable}
            onChange={(e) => {
              stageFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <p className="help-text">
            {isCloudProvider
              ? `Select one or more recipe pages (up to ${OCR_LIMITS.maxPages}) for server-side OCR, order them, then recognize.`
              : `Select one or more recipe pages (up to ${OCR_LIMITS.maxPages}) for browser-based OCR, order them, then recognize.`}
          </p>

          {staged.length > 0 ? (
            <div className="flex flex-col gap-2">
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {staged.map((page, index) => (
                  <li key={page.id} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={page.previewUrl}
                      alt={`Recipe page ${index + 1}`}
                      className="h-24 w-full rounded-lg border border-border object-cover"
                    />
                    <span className="absolute left-1 top-1 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground">
                      page {index + 1}
                    </span>
                    <div className="mt-1 flex items-center justify-center gap-1">
                      <button
                        type="button"
                        className="btn-secondary px-2 py-1 text-xs"
                        onClick={() => movePage(index, -1)}
                        disabled={busy || index === 0}
                        aria-label={`Move page ${index + 1} earlier`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn-secondary px-2 py-1 text-xs"
                        onClick={() => movePage(index, 1)}
                        disabled={busy || index === staged.length - 1}
                        aria-label={`Move page ${index + 1} later`}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="btn-secondary px-2 py-1 text-xs"
                        onClick={() => removePage(page.id)}
                        disabled={busy}
                        aria-label={`Remove page ${index + 1}`}
                      >
                        ×
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <div>
                <button
                  type="button"
                  className="btn-primary min-h-11 w-full sm:w-auto"
                  onClick={recognizeStaged}
                  disabled={busy || staged.length === 0}
                >
                  {busy ? "Working…" : staged.length === 1 ? "Recognize page" : `Recognize ${staged.length} pages`}
                </button>
              </div>
            </div>
          ) : null}
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
