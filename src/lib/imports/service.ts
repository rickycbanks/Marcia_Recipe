import type { Account, RecipeDraft } from "@/types";
import { audit } from "@/lib/audit/log";
import { forbidden, notFound } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { ssrfSafeFetch, type FetchOptions } from "./fetch";
import { extractRecipeFromHtml } from "./parse";
import { parseRecipeText } from "./ocr";

/**
 * Owner-only URL import. Tries fetch strategies in order; every strategy
 * goes through the SSRF-safe fetcher. The endpoint NEVER persists a recipe —
 * it returns a draft that the owner reviews in the editor before saving.
 */

export type ImportStrategy = "direct" | "print-view" | "wayback" | "jina";

export interface ImportResult {
  draft: RecipeDraft;
  strategy: ImportStrategy;
  via: string;
  finalUrl: string;
  attempts: { strategy: ImportStrategy; error?: string }[];
}

function ensureOwner(account: Account): void {
  if (account.type !== "owner") throw forbidden("Only the owner can import recipes");
}

async function tryDirect(url: string, opts: FetchOptions): Promise<ImportResult | null> {
  const page = await ssrfSafeFetch(url, opts);
  const extracted = extractRecipeFromHtml(page.body, page.finalUrl);
  if (!extracted) return null;
  return { draft: extracted.draft, strategy: "direct", via: extracted.via, finalUrl: page.finalUrl, attempts: [] };
}

async function tryPrintView(url: string, opts: FetchOptions): Promise<ImportResult | null> {
  const withParam = new URL(url);
  withParam.searchParams.set("print", "1");
  const page = await ssrfSafeFetch(withParam.toString(), opts);
  const extracted = extractRecipeFromHtml(page.body, page.finalUrl);
  if (!extracted) return null;
  return { draft: extracted.draft, strategy: "print-view", via: extracted.via, finalUrl: page.finalUrl, attempts: [] };
}

async function tryWayback(url: string, opts: FetchOptions): Promise<ImportResult | null> {
  // Ask the Wayback Machine for the newest snapshot, then fetch THAT (both
  // requests are to public archive.org hosts, still via the SSRF guard).
  const api = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
  const availability = await ssrfSafeFetch(api, {
    ...opts,
    allowedContentTypes: /^(application\/json|text\/plain)/i,
  });
  let snapshotUrl: string | null = null;
  try {
    const parsed = JSON.parse(availability.body) as {
      archived_snapshots?: { snapshot?: { url?: string; status?: string } };
    };
    snapshotUrl = parsed.archived_snapshots?.snapshot?.url ?? null;
  } catch {
    return null;
  }
  if (!snapshotUrl) return null;
  const page = await ssrfSafeFetch(snapshotUrl, opts);
  const extracted = extractRecipeFromHtml(page.body, url);
  if (!extracted) return null;
  return { draft: extracted.draft, strategy: "wayback", via: extracted.via, finalUrl: page.finalUrl, attempts: [] };
}

async function tryJina(url: string, opts: FetchOptions): Promise<ImportResult | null> {
  // r.jina.ai renders a page to plain markdown text; parse it with the OCR heuristics.
  const page = await ssrfSafeFetch(`https://r.jina.ai/${url}`, {
    ...opts,
    allowedContentTypes: /^(text\/plain|text\/markdown|text\/html)/i,
  });
  const draft = parseRecipeText(page.body);
  if (!draft.title || draft.ingredients.length === 0) return null;
  draft.sourceUrl = url;
  return { draft, strategy: "jina", via: "text-heuristics", finalUrl: page.finalUrl, attempts: [] };
}

export async function importRecipeFromUrl(
  account: Account,
  url: string,
  opts: FetchOptions = {},
): Promise<ImportResult> {
  ensureOwner(account);
  const attempts: ImportResult["attempts"] = [];
  const strategies: [ImportStrategy, (u: string, o: FetchOptions) => Promise<ImportResult | null>][] = [
    ["direct", tryDirect],
    ["print-view", tryPrintView],
    ["wayback", tryWayback],
    ["jina", tryJina],
  ];
  for (const [name, fn] of strategies) {
    try {
      const result = await fn(url, opts);
      if (result) {
        result.attempts = attempts;
        await audit({
          type: "import.performed",
          actorAccountId: account.id,
          clientAddress: null,
          detail: { url, strategy: name, via: result.via },
        });
        return result;
      }
      attempts.push({ strategy: name, error: "no recipe found" });
    } catch (err) {
      logger.info("Import strategy failed", { strategy: name, error: String(err) });
      attempts.push({ strategy: name, error: err instanceof Error ? err.message : String(err) });
    }
  }
  throw notFound("No recipe could be extracted from that URL");
}

/** Server-side parse of OCR text (kept here so heuristics are shared & tested). */
export function parseOcrText(account: Account, text: string): RecipeDraft {
  ensureOwner(account);
  return parseRecipeText(text);
}
