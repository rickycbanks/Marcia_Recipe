/**
 * Browser-only image preprocessing for Tesseract OCR.
 * Do not import from server-side modules — this file uses `document`, `Image`,
 * and `canvas`, and only ever runs in the browser (it is imported by the admin
 * client component). The pure math helpers are exported separately so they can
 * be unit-tested in Node.
 */

/** Luminance grayscale (BT.709) value for a pixel. Pure, testable. */
export function grayscalePixel(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Luminance grayscale (BT.709) → 0 or 255 via threshold. Pure, testable. */
export function binarizePixel(r: number, g: number, b: number, threshold = 140): 0 | 255 {
  return grayscalePixel(r, g, b) >= threshold ? 255 : 0;
}

/** Scale factor to reach min width, capped at maxScale. Pure, testable. */
export function upscaleFactor(width: number, minWidth = 1500, maxScale = 3): number {
  if (width <= 0 || minWidth <= 0 || maxScale < 1) return 1;
  return Math.min(Math.max(minWidth / width, 1), maxScale);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load image for OCR preprocessing"));
    image.src = src;
  });
}

/**
 * Preprocess an image File/Blob for Tesseract OCR via a canvas:
 * - upscales so width >= 1500px (capped at 3x)
 * - adds a 12px white border
 * - converts to grayscale (no binarization — Tesseract's internal adaptive
 *   binarization handles contrast; a hard threshold can destroy low-contrast
 *   or colored regions like recipe metadata boxes)
 * Returns a PNG Blob. Browser-only; do not import server-side.
 */
export async function preprocessImageForOcr(source: Blob): Promise<Blob> {
  if (typeof document === "undefined" || typeof Image === "undefined" || typeof URL === "undefined") {
    throw new Error("Image preprocessing is only available in the browser");
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is not available");

  const objectUrl = URL.createObjectURL(source);
  try {
    const image = await loadImage(objectUrl);

    const scale = upscaleFactor(image.naturalWidth);
    const border = 12;
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));

    canvas.width = width + border * 2;
    canvas.height = height + border * 2;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, border, border, width, height);

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const { data } = imageData;
    for (let i = 0; i < data.length; i += 4) {
      const gray = grayscalePixel(data[i]!, data[i + 1]!, data[i + 2]!);
      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
      data[i + 3] = 255;
    }
    context.putImageData(imageData, 0, 0);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not encode preprocessed image"));
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
