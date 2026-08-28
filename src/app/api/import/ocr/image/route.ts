import { apiHandler, jsonOk } from "@/lib/api";
import { requireCapability } from "@/lib/authorization/guards";
import { badRequest } from "@/lib/errors";
import { recognizeAndExtractRecipe } from "@/lib/imports/providers/dispatcher";
import { getEffectiveOcrProvider } from "@/lib/config/ocrPrivate";
import { OCR_LIMITS } from "@/lib/validation/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner-only server-side OCR. The uploaded image is dispatched to the
 * site-wide active cloud provider for two-pass recognition + extraction.
 * Nothing is persisted here — the recognized draft is returned for owner
 * review before saving, and the image itself is never stored.
 *
 * Cloud pipeline:
 *   Pass 1: image → OCR text (provider-specific OCR endpoint/model)
 *   Pass 2: OCR text → structured recipe JSON (provider-specific chat/vision model)
 * The structured result is converted to a RecipeDraft. If pass 2 fails,
 * the heuristic parser is used as a fallback on pass-1 text.
 */
export const POST = apiHandler(async (request) => {
  await requireCapability("recipes.import");
  const activeProvider = await getEffectiveOcrProvider();
  if (activeProvider === "tesseract") {
    throw badRequest("Tesseract OCR runs in the browser. Upload a photo and the browser will recognize text locally.");
  }

  const form = await request.formData().catch(() => {
    throw badRequest("Expected multipart form data");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Missing image file");
  if (file.size > OCR_LIMITS.maxImageBytes) throw badRequest("Image exceeds the size limit");
  const allowed = OCR_LIMITS.allowedMimeTypes as readonly string[];
  if (!allowed.includes(file.type)) throw badRequest("Unsupported image type");

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await recognizeAndExtractRecipe(buffer, file.type);
  return jsonOk({ draft: result.draft, via: `${activeProvider}-ocr`, status: result.status });
});
