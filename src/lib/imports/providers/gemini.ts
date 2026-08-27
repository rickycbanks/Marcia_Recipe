/**
 * Gemini OCR + structured extraction provider.
 *
 * Pass 1: gemini-3.5-flash-lite vision model — image + transcription instruction → OCR markdown.
 * Pass 2: same gemini-3.5-flash-lite model — pass-1 text → structured recipe JSON.
 *
 * Uses the official Google Generative Language REST API. No SDK dependency.
 * The API key is loaded from the encrypted private config — never from env.
 */

import { badRequest, upstreamFetch } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getGeminiSecrets } from "@/lib/config/ocrPrivate";
import { OCR_LIMITS } from "@/lib/validation/constants";
import {
  EXTRACTION_USER_PROMPT_PREFIX,
  SYSTEM_PROMPT,
  geminiExtractionSchema,
  type ExtractionResult,
} from "./structuredRecipe";
import { parseRecipeText } from "@/lib/imports/ocr";

const GEMINI_MODEL = "gemini-3.5-flash-lite";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

const PASS1_INSTRUCTION =
  "Transcribe the text from this recipe image into clean Markdown format. " +
  "Preserve all ingredient quantities, units, and cooking instructions exactly as written. " +
  "Do not add, omit, or alter any information. " +
  "Return only the transcribed text — no commentary.";

/* -------------------------------- types ---------------------------------- */

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiGenerateRequest {
  contents: GeminiContent[];
  systemInstruction?: { parts: GeminiPart[] };
  generationConfig: {
    temperature: number;
    responseMimeType?: string;
    responseSchema?: Record<string, unknown>;
  };
}

interface GeminiCandidate {
  content?: { parts?: { text?: string }[] };
  finishReason?: string;
}

interface GeminiGenerateResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
}

export interface GeminiResponseLike {
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
  const body: GeminiGenerateRequest = {
    contents: [
      {
        role: "user",
        parts: [
          { text: PASS1_INSTRUCTION },
          { inlineData: { mimeType, data: imageBuffer.toString("base64") } },
        ],
      },
    ],
    generationConfig: { temperature: 0 },
  };

  let response: GeminiResponseLike;
  try {
    response = await fetchImpl(`${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(OCR_LIMITS.passTimeoutMs),
    }) as unknown as GeminiResponseLike;
  } catch (err) {
    throw upstreamFetch("Gemini OCR request failed", {
      cause: err instanceof Error ? err.message : String(err),
    });
  }

  if (!response.ok) {
    throw upstreamFetch("Gemini OCR request failed", { status: response.status });
  }

  const data = (await response.json().catch(() => null)) as GeminiGenerateResponse | null;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text || !text.trim()) {
    throw upstreamFetch("Gemini OCR returned no text");
  }

  return text.trim();
}

/* --------------------------------- pass 2 --------------------------------- */

async function passTwo(
  ocrText: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const userContent = `${EXTRACTION_USER_PROMPT_PREFIX}${ocrText}`;

  const body: GeminiGenerateRequest = {
    contents: [{ role: "user", parts: [{ text: userContent }] }],
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: geminiExtractionSchema(),
    },
  };

  let response: GeminiResponseLike;
  try {
    response = await fetchImpl(`${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(OCR_LIMITS.passTimeoutMs),
    }) as unknown as GeminiResponseLike;
  } catch (err) {
    throw upstreamFetch("Gemini extraction request failed", {
      cause: err instanceof Error ? err.message : String(err),
    });
  }

  if (!response.ok) {
    throw upstreamFetch("Gemini extraction request failed", { status: response.status });
  }

  const data = (await response.json().catch(() => null)) as GeminiGenerateResponse | null;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text || !text.trim()) {
    throw upstreamFetch("Gemini extraction returned no text");
  }

  return text.trim();
}

/* -------------------------------- exported -------------------------------- */

/**
 * Two-pass Gemini pipeline: pass 1 (image → OCR text) → pass 2 (text → structured JSON).
 * Falls back to the heuristic parser if pass 2 fails.
 * Never exposes provider response bodies in errors.
 */
export async function recognizeAndExtractWithGemini(
  imageBuffer: Buffer,
  mimeType: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ExtractionResult> {
  const secrets = await getGeminiSecrets();
  if (!secrets) {
    throw badRequest(
      "Gemini OCR is not configured. Ask the site owner to add a Gemini API key in Admin Settings.",
    );
  }

  // Pass 1: image → OCR text
  const ocrText = await passOne(imageBuffer, mimeType, secrets.apiKey, fetchImpl);
  logger.info("Gemini pass-1 OCR completed", { bytes: imageBuffer.byteLength });

  // Pass 2: OCR text → structured recipe JSON
  let rawJson: string;
  try {
    rawJson = await passTwo(ocrText, secrets.apiKey, fetchImpl);
    logger.info("Gemini pass-2 extraction completed");
  } catch {
    // Pass 2 failure: fall back to the heuristic parser on pass-1 text
    logger.warn("Gemini pass-2 failed; using heuristic fallback");
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
  logger.warn("Gemini structured extraction validation failed; using heuristic fallback");
  const fallbackDraft = parseRecipeText(ocrText);
  return { draft: fallbackDraft, status: "heuristic-fallback" };
}
