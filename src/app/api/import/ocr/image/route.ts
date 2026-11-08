import { apiHandler, jsonOk } from "@/lib/api";
import { requireCapability } from "@/lib/authorization/guards";
import { badRequest } from "@/lib/errors";
import { recognizeAndExtractRecipePages, type OcrPageImage } from "@/lib/imports/providers/dispatcher";
import { getEffectiveOcrProvider } from "@/lib/config/ocrPrivate";
import { OCR_LIMITS } from "@/lib/validation/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner-only server-side OCR. One or more uploaded page images are dispatched
 * to the site-wide active cloud provider. Each page is recognized (pass 1) in
 * the submitted order and the combined text is extracted once (pass 2), so a
 * recipe spanning multiple book pages becomes one draft.
 * Nothing is persisted here — the recognized draft is returned for owner
 * review before saving, and the images themselves are never stored.
 *
 * Accepts any number of "files" entries; a single "file" entry is also
 * honored for compatibility with one-page callers.
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
  const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
  const legacy = form.get("file");
  if (files.length === 0 && legacy instanceof File) files.push(legacy);
  if (files.length === 0) throw badRequest("Missing image file");

  const allowed = OCR_LIMITS.allowedMimeTypes as readonly string[];
  const images: OcrPageImage[] = [];
  for (const [index, file] of files.entries()) {
    if (!allowed.includes(file.type)) {
      throw badRequest(`Unsupported image type on page ${index + 1}. Use PNG, JPEG, or AVIF.`);
    }
    if (file.size > OCR_LIMITS.maxImageBytes) {
      throw badRequest(`The photo on page ${index + 1} exceeds the size limit.`);
    }
    images.push({ buffer: Buffer.from(await file.arrayBuffer()), mimeType: file.type });
  }

  const result = await recognizeAndExtractRecipePages(images);
  return jsonOk({ draft: result.draft, via: `${activeProvider}-ocr`, status: result.status });
});
