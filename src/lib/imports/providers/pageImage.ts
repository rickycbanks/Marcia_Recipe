import { badRequest } from "@/lib/errors";
import { OCR_LIMITS } from "@/lib/validation/constants";

/** One page image submitted to the cloud OCR pipeline. */
export interface OcrPageImage {
  buffer: Buffer;
  mimeType: string;
}

/**
 * Validate multi-page OCR images against the shared limits: page count,
 * combined size, and per-page type/size (errors name the 1-based page index
 * so the owner knows which photo to retake).
 */
export function validateOcrPageImages(images: readonly OcrPageImage[]): void {
  if (images.length === 0) throw badRequest("No images provided");
  if (images.length > OCR_LIMITS.maxPages) {
    throw badRequest(`Too many pages. A recipe scan can include at most ${OCR_LIMITS.maxPages} photos.`);
  }
  const allowed = OCR_LIMITS.allowedMimeTypes as readonly string[];
  let totalBytes = 0;
  for (const [index, image] of images.entries()) {
    if (!allowed.includes(image.mimeType)) {
      throw badRequest(`Unsupported image type on page ${index + 1}. Use PNG, JPEG, or AVIF.`);
    }
    if (image.buffer.byteLength > OCR_LIMITS.maxImageBytes) {
      throw badRequest(`The photo on page ${index + 1} exceeds the size limit.`);
    }
    totalBytes += image.buffer.byteLength;
  }
  if (totalBytes > OCR_LIMITS.maxTotalImageBytes) {
    throw badRequest("The combined photos exceed the OCR size limit.");
  }
}
