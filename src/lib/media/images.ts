import sharp, { type Metadata, type Sharp } from "sharp";
import { payloadTooLarge, unsupportedMedia } from "@/lib/errors";
import { MEDIA_LIMITS } from "@/lib/validation/constants";

/**
 * Image upload pipeline. Validation is based on DECODED content (sharp reads
 * the real bytes), never on client-supplied MIME types:
 * - size cap before decode
 * - pixel cap via limitInputPixels (decompression-bomb defense)
 * - decoded format allowlist
 * - EXIF rotation, bounded resize, WebP re-encode (strips any payload)
 */

const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp", "avif", "tiff", "gif"]);

export interface ProcessedImage {
  buffer: Buffer;
  width: number;
  height: number;
  bytes: number;
}

export async function processImageUpload(input: Buffer): Promise<ProcessedImage> {
  if (input.byteLength === 0) throw unsupportedMedia("Empty upload");
  if (input.byteLength > MEDIA_LIMITS.maxUploadBytes) {
    throw payloadTooLarge(`Image exceeds the ${MEDIA_LIMITS.maxUploadBytes / 1024 / 1024} MB limit`);
  }
  // SVG is XML, not a raster format — reject up front (sharp would rasterize it).
  const head = input.subarray(0, 256).toString("utf8");
  if (/^\s*(<\?xml|<svg|<!DOCTYPE\s+svg)/i.test(head)) {
    throw unsupportedMedia("SVG uploads are not supported");
  }

  let pipeline: Sharp;
  try {
    pipeline = sharp(input, {
      limitInputPixels: MEDIA_LIMITS.maxPixels,
      animated: false, // first frame only for animated formats
    });
  } catch {
    throw unsupportedMedia("Could not decode image content");
  }

  let metadata: Metadata;
  try {
    metadata = await pipeline.metadata();
  } catch {
    throw unsupportedMedia("Could not decode image content");
  }
  if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
    throw unsupportedMedia(`Unsupported image format: ${metadata.format ?? "unknown"}`);
  }
  const pixels = (metadata.width ?? 0) * (metadata.height ?? 0);
  if (!pixels || pixels > MEDIA_LIMITS.maxPixels) {
    throw payloadTooLarge("Image dimensions exceed the allowed pixel limit");
  }

  try {
    const { data, info } = await pipeline
      .rotate() // honor EXIF orientation, then strip metadata
      .resize({
        width: MEDIA_LIMITS.maxDimension,
        height: MEDIA_LIMITS.maxDimension,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: MEDIA_LIMITS.webpQuality })
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height, bytes: data.byteLength };
  } catch {
    throw unsupportedMedia("Failed to process image");
  }
}
