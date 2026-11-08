/**
 * Server-side OCR provider abstraction. Dispatches to the correct provider
 * based on the site-wide admin configuration. Never exposes provider secrets
 * in error messages, logs, or return values.
 *
 * Cloud providers (Mistral, Gemini) use a two-pass pipeline:
 *   Pass 1: image → OCR text
 *   Pass 2: OCR text → structured recipe JSON
 * The structured result is converted to a RecipeDraft and validated.
 * Pass-2 failures fall back to the heuristic parser on pass-1 text.
 */

import { badRequest } from "@/lib/errors";
import {
  getEffectiveOcrProvider,
  type OcrProvider,
} from "@/lib/config/ocrPrivate";
import { recognizeAndExtractWithMistralPages } from "./mistral";
import { recognizeAndExtractWithGeminiPages } from "./gemini";
import { validateOcrPageImages, type OcrPageImage } from "./pageImage";
import { OCR_LIMITS } from "@/lib/validation/constants";
import type { ExtractionResult } from "./structuredRecipe";

export type { OcrProvider };
export type { OcrPageImage };

export interface RecognizeOptions {
  /** Override the fetch implementation (for tests). */
  fetchImpl?: typeof fetch;
}

/**
 * Dispatch one or more page images to the site-wide active OCR provider and
 * return a structured recipe draft via the two-pass pipeline. Pass 1 runs
 * per page in the given order; the concatenated page text is parsed once by
 * pass 2, so multi-page recipes arrive as a single draft.
 *
 * Tesseract runs client-side and never reaches this path.
 * Throws AppError-based errors so route handlers can map them safely.
 */
export async function recognizeAndExtractRecipePages(
  images: readonly OcrPageImage[],
  options: RecognizeOptions = {},
): Promise<ExtractionResult> {
  const provider = await getEffectiveOcrProvider();

  if (provider === "tesseract") {
    throw badRequest(
      "Tesseract OCR runs in the browser. Upload a photo and the browser will recognize text locally.",
    );
  }

  validateOcrPageImages(images);

  switch (provider) {
    case "mistral":
      return recognizeAndExtractWithMistralPages(images, options.fetchImpl);
    case "gemini":
      return recognizeAndExtractWithGeminiPages(images, options.fetchImpl);
    default:
      throw badRequest(`Unsupported OCR provider: ${provider}`);
  }
}

/**
 * Dispatch a single image to the active OCR provider.
 * Single-page convenience wrapper around recognizeAndExtractRecipePages.
 */
export async function recognizeAndExtractRecipe(
  imageBuffer: Buffer,
  mimeType: string,
  options: RecognizeOptions = {},
): Promise<ExtractionResult> {
  const allowed = OCR_LIMITS.allowedMimeTypes as readonly string[];
  if (!allowed.includes(mimeType)) {
    throw badRequest(`Unsupported image type: ${mimeType}`);
  }
  if (imageBuffer.byteLength > OCR_LIMITS.maxImageBytes) {
    throw badRequest("Image exceeds the OCR size limit");
  }
  return recognizeAndExtractRecipePages([{ buffer: imageBuffer, mimeType }], options);
}

/**
 * Legacy single-text recognizer. Used by Tesseract text parsing route
 * and the Jina import path. For cloud providers, prefer recognizeAndExtractRecipe.
 */
export async function recognizeImage(
  imageBuffer: Buffer,
  mimeType: string,
  options: RecognizeOptions = {},
): Promise<string> {
  const provider = await getEffectiveOcrProvider();

  if (provider === "tesseract") {
    throw badRequest(
      "Tesseract OCR runs in the browser. Upload a photo and the browser will recognize text locally.",
    );
  }

  const allowed = OCR_LIMITS.allowedMimeTypes as readonly string[];
  if (!allowed.includes(mimeType)) {
    throw badRequest(`Unsupported image type: ${mimeType}`);
  }
  if (imageBuffer.byteLength > OCR_LIMITS.maxImageBytes) {
    throw badRequest("Image exceeds the OCR size limit");
  }

  // For cloud providers, use the two-pass pipeline and return the pass-1 text
  switch (provider) {
    case "mistral": {
      const { recognizeImageWithMistral } = await import("./mistral");
      return recognizeImageWithMistral(imageBuffer, mimeType, options.fetchImpl);
    }
    case "gemini": {
      // Gemini pass-1 is internal to recognizeAndExtractWithGemini;
      // this legacy path is only used for text-only routes, so throw.
      throw badRequest(
        "Use the two-pass extraction endpoint for Gemini OCR.",
      );
    }
    default:
      throw badRequest(`Unsupported OCR provider: ${provider}`);
  }
}
