import { apiHandler, jsonOk } from "@/lib/api";
import { requireCapability } from "@/lib/authorization/guards";
import { badRequest, payloadTooLarge } from "@/lib/errors";
import { recognizeImageWithMistral } from "@/lib/imports/mistralOcr";
import { parseOcrText } from "@/lib/imports/service";
import { OCR_LIMITS } from "@/lib/validation/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner-only server-side OCR. The uploaded image is sent to Mistral's API for
 * recognition; requires `MISTRAL_API_KEY` to be set. Nothing is persisted
 * here — the recognized text is parsed into a draft for owner review before
 * saving, and the image itself is never stored.
 */
export const POST = apiHandler(async (request) => {
  const owner = await requireCapability("recipes.import");
  const form = await request.formData().catch(() => {
    throw badRequest("Expected multipart form data");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Missing image file");
  if (file.size > OCR_LIMITS.maxImageBytes) throw payloadTooLarge("Image exceeds the size limit");
  const allowed = OCR_LIMITS.allowedMimeTypes as readonly string[];
  if (!allowed.includes(file.type)) throw badRequest("Unsupported image type");

  const buffer = Buffer.from(await file.arrayBuffer());
  const text = await recognizeImageWithMistral(buffer, file.type);
  if (!text.trim()) throw badRequest("No text could be recognized in that image");

  const draft = parseOcrText(owner, text);
  return jsonOk({ draft, via: "mistral-ocr" });
});
