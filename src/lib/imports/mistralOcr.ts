import { fetch as undiciFetch } from "undici";
import { getEnv } from "@/lib/env";
import { badRequest, payloadTooLarge, upstreamFetch } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { OCR_LIMITS } from "@/lib/validation/constants";

const MISTRAL_OCR_URL = "https://api.mistral.ai/v1/ocr";
const MISTRAL_MODEL = "mistral-ocr-latest";

/** Minimal Response shape the client needs, so tests can stub it easily. */
export interface MistralResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

/** Options for `recognizeImageWithMistral`; both fields are test seams. */
export interface RecognizeMistralOptions {
  /** Override the fetch implementation (defaults to undici's fetch). */
  fetchImpl?: (url: string, init: RequestInit) => Promise<MistralResponseLike>;
  /** Override the API key (defaults to `getEnv().MISTRAL_API_KEY`). */
  apiKey?: string;
}

/**
 * True when a Mistral API key is configured, which enables the optional
 * server-side OCR engine (the browser-side Tesseract.js flow remains default).
 */
export function isMistralOcrConfigured(): boolean {
  return !!getEnv().MISTRAL_API_KEY;
}

/**
 * Server-side OCR via the Mistral API. The image is base64-encoded into a data
 * URI and sent inline; recognized markdown from all pages is joined and
 * returned. Never logs the image bytes or the API key. Throws AppError-based
 * errors so route handlers can map them to safe client responses.
 */
export async function recognizeImageWithMistral(
  imageBuffer: Buffer,
  mimeType: string,
  options: RecognizeMistralOptions = {},
): Promise<string> {
  const apiKey = options.apiKey ?? getEnv().MISTRAL_API_KEY;
  if (!apiKey) throw badRequest("Server OCR is not configured");

  const allowed = OCR_LIMITS.allowedMimeTypes as readonly string[];
  if (!allowed.includes(mimeType)) throw badRequest(`Unsupported image type: ${mimeType}`);
  if (imageBuffer.byteLength > OCR_LIMITS.maxImageBytes) {
    throw payloadTooLarge("Image exceeds the OCR size limit");
  }

  const dataUri = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
  // Next.js patches the global fetch inside route handlers, which can surface
  // as opaque "TypeError: fetch failed" for outbound calls. undici's fetch is
  // used directly (as the SSRF-safe importer does) to avoid that layer.
  const fetchImpl = options.fetchImpl ?? undiciFetch;

  let response: MistralResponseLike;
  try {
    response = await fetchImpl(MISTRAL_OCR_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: MISTRAL_MODEL,
        document: { image_url: dataUri },
      }),
      signal: AbortSignal.timeout(OCR_LIMITS.timeoutMs),
    });
  } catch (err) {
    throw upstreamFetch("Mistral OCR request failed", {
      cause: err instanceof Error ? err.message : String(err),
    });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw upstreamFetch("Mistral OCR request failed", { status: response.status, body });
  }

  const data = (await response.json().catch(() => null)) as { pages?: { markdown?: string }[] } | null;
  const pages = data?.pages ?? [];
  const text = pages
    .map((page) => page.markdown)
    .filter((markdown): markdown is string => Boolean(markdown && markdown.trim()))
    .join("\n\n---\n\n");
  if (!text) throw upstreamFetch("Mistral OCR returned no text");

  logger.info("Mistral OCR performed", { bytes: imageBuffer.byteLength, pages: pages.length });
  return text;
}
