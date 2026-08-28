import { z } from "zod";
import { apiHandler, jsonOk, parseBody } from "@/lib/api";
import { requireCapability } from "@/lib/authorization/guards";
import { getEffectiveOcrProvider } from "@/lib/config/ocrPrivate";
import { parseOcrText } from "@/lib/imports/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ text: z.string().min(1).max(50_000) });

/**
 * Owner-only OCR text parsing. The image never leaves the browser (Tesseract.js
 * runs client-side); only recognized text is parsed here into a reviewable draft.
 */
export const POST = apiHandler(async (request) => {
  const owner = await requireCapability("recipes.import");
  const { text } = await parseBody(request, bodySchema);
  return jsonOk({ draft: parseOcrText(owner, text) });
});

/**
 * Report OCR capability metadata. The active provider is server-selected;
 * clients cannot choose or force a provider.
 */
export const GET = apiHandler(async () => {
  const activeProvider = await getEffectiveOcrProvider();
  return jsonOk({
    activeProvider,
    mistralEnabled: activeProvider === "mistral",
    geminiEnabled: activeProvider === "gemini",
  });
});
