/**
 * Mistral OCR + structured extraction provider.
 *
 * Pass 1: POST https://api.mistral.ai/v1/ocr — fixed mistral-ocr-latest model → OCR markdown.
 * Pass 2: POST https://api.mistral.ai/v1/chat/completions — fixed ministral-3b-2512 model,
 *          strict json_schema response format → structured recipe JSON.
 *
 * The API key is loaded from the encrypted private config, falling back to
 * MISTRAL_API_KEY env for legacy deployments.
 */

import { fetch as undiciFetch } from "undici";
import { badRequest, upstreamFetch } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getMistralSecrets } from "@/lib/config/ocrPrivate";
import { OCR_LIMITS } from "@/lib/validation/constants";
import {
  EXTRACTION_USER_PROMPT_PREFIX,
  SYSTEM_PROMPT,
  mistralExtractionSchema,
  type ExtractionResult,
} from "./structuredRecipe";
import { parseRecipeText } from "@/lib/imports/ocr";

const MISTRAL_OCR_URL = "https://api.mistral.ai/v1/ocr";
const MISTRAL_CHAT_URL = "https://api.mistral.ai/v1/chat/completions";
const MISTRAL_OCR_MODEL = "mistral-ocr-latest";
const MISTRAL_CHAT_MODEL = "ministral-3b-2512";

export interface MistralResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

/* --------------------------------- pass 1 --------------------------------- */

async function passOne(
  imageBuffer: Buffer,
  mimeType: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const dataUri = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

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
        model: MISTRAL_OCR_MODEL,
        document: { image_url: dataUri },
      }),
      signal: AbortSignal.timeout(OCR_LIMITS.passTimeoutMs),
    }) as unknown as MistralResponseLike;
  } catch (err) {
    throw upstreamFetch("Mistral OCR request failed", {
      cause: err instanceof Error ? err.message : String(err),
    });
  }

  if (!response.ok) {
    throw upstreamFetch("Mistral OCR request failed", { status: response.status });
  }

  const data = (await response.json().catch(() => null)) as { pages?: { markdown?: string }[] } | null;
  const pages = data?.pages ?? [];
  const text = pages
    .map((page) => page.markdown)
    .filter((markdown): markdown is string => Boolean(markdown && markdown.trim()))
    .join("\n\n---\n\n");
  if (!text) throw upstreamFetch("Mistral OCR returned no text");

  return text;
}

/* --------------------------------- pass 2 --------------------------------- */

async function passTwo(
  ocrText: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const userContent = `${EXTRACTION_USER_PROMPT_PREFIX}${ocrText}`;

  let response: MistralResponseLike;
  try {
    response = await fetchImpl(MISTRAL_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: MISTRAL_CHAT_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "recipe_extraction",
            schema: mistralExtractionSchema(),
            strict: true,
          },
        },
        temperature: 0,
      }),
      signal: AbortSignal.timeout(OCR_LIMITS.passTimeoutMs),
    }) as unknown as MistralResponseLike;
  } catch (err) {
    throw upstreamFetch("Mistral extraction request failed", {
      cause: err instanceof Error ? err.message : String(err),
    });
  }

  if (!response.ok) {
    throw upstreamFetch("Mistral extraction request failed", { status: response.status });
  }

  const data = (await response.json().catch(() => null)) as
    { choices?: { message?: { content?: string } }[] }
    | null;
  const text = data?.choices?.[0]?.message?.content;
  if (!text || !text.trim()) {
    throw upstreamFetch("Mistral extraction returned no text");
  }

  return text.trim();
}

/* -------------------------------- exported -------------------------------- */

/**
 * Server-side OCR via the Mistral API.
 * Never logs the image bytes or the API key.
 */
export async function recognizeImageWithMistral(
  imageBuffer: Buffer,
  mimeType: string,
  fetchImpl: typeof fetch = undiciFetch as unknown as typeof fetch,
): Promise<string> {
  const secrets = await getMistralSecrets();
  if (!secrets) {
    throw badRequest(
      "Mistral OCR is not configured. Ask the site owner to add a Mistral API key in Admin Settings.",
    );
  }

  const allowed = OCR_LIMITS.allowedMimeTypes as readonly string[];
  if (!allowed.includes(mimeType)) {
    throw badRequest(`Unsupported image type: ${mimeType}`);
  }
  if (imageBuffer.byteLength > OCR_LIMITS.maxImageBytes) {
    throw badRequest("Image exceeds the OCR size limit");
  }

  const text = await passOne(imageBuffer, mimeType, secrets.apiKey, fetchImpl);
  logger.info("Mistral OCR performed", { bytes: imageBuffer.byteLength });
  return text;
}

/**
 * Two-pass Mistral pipeline: pass 1 (image → OCR text) → pass 2 (text → structured JSON).
 * Falls back to the heuristic parser if pass 2 fails.
 * Never exposes provider response bodies in errors.
 */
export async function recognizeAndExtractWithMistral(
  imageBuffer: Buffer,
  mimeType: string,
  fetchImpl: typeof fetch = undiciFetch as unknown as typeof fetch,
): Promise<ExtractionResult> {
  const secrets = await getMistralSecrets();
  if (!secrets) {
    throw badRequest(
      "Mistral OCR is not configured. Ask the site owner to add a Mistral API key in Admin Settings.",
    );
  }

  const allowed = OCR_LIMITS.allowedMimeTypes as readonly string[];
  if (!allowed.includes(mimeType)) {
    throw badRequest(`Unsupported image type: ${mimeType}`);
  }
  if (imageBuffer.byteLength > OCR_LIMITS.maxImageBytes) {
    throw badRequest("Image exceeds the OCR size limit");
  }

  // Pass 1: image → OCR text
  const ocrText = await passOne(imageBuffer, mimeType, secrets.apiKey, fetchImpl);
  logger.info("Mistral pass-1 OCR completed", { bytes: imageBuffer.byteLength });

  // Pass 2: OCR text → structured recipe JSON
  let rawJson: string;
  try {
    rawJson = await passTwo(ocrText, secrets.apiKey, fetchImpl);
    logger.info("Mistral pass-2 extraction completed");
  } catch {
    // Pass 2 failure: fall back to the heuristic parser on pass-1 text
    logger.warn("Mistral pass-2 failed; using heuristic fallback");
    const draft = parseRecipeText(ocrText);
    return { draft, status: "heuristic-fallback" };
  }

  // Parse and validate the structured JSON
  const { tryStructuredExtraction } = await import("./structuredRecipe");
  const draft = tryStructuredExtraction(rawJson);
  if (draft) {
    return { draft, status: "ai-normalized" };
  }

  // Validation failed: fall back to the heuristic parser
  logger.warn("Mistral structured extraction validation failed; using heuristic fallback");
  const fallbackDraft = parseRecipeText(ocrText);
  return { draft: fallbackDraft, status: "heuristic-fallback" };
}
