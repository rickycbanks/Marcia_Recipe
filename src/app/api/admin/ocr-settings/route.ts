import { z } from "zod";
import { apiHandler, jsonOk, parseBody } from "@/lib/api";
import { audit } from "@/lib/audit/log";
import { requireOwner } from "@/lib/authorization/guards";
import { getSanitizedOcrConfig, savePrivateOcrConfig } from "@/lib/config/ocrPrivate";
import { withWriteLock } from "@/lib/storage/lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OCR_PROVIDERS = ["tesseract", "mistral", "gemini"] as const;

const patchSchema = z.object({
  activeProvider: z.enum(OCR_PROVIDERS).optional(),
  mistral: z
    .object({
      apiKey: z.string().optional(),
    })
    .optional()
    .nullable(),
  gemini: z
    .object({
      apiKey: z.string().optional(),
    })
    .optional()
    .nullable(),
});

/**
 * Owner-only OCR settings. GET returns sanitized status (no secrets);
 * PATCH updates the encrypted private config. Legacy provider fields
 * (googleDocumentAi, veryfi) are silently discarded on save.
 */
export const GET = apiHandler(async () => {
  await requireOwner();
  const config = await getSanitizedOcrConfig();
  return jsonOk(config);
});

export const PATCH = apiHandler(async (request) => {
  const owner = await requireOwner();
  const patch = await parseBody(request, patchSchema);
  await withWriteLock(async () => {
    await savePrivateOcrConfig(patch);
  });
  await audit({
    type: "settings.updated",
    actorAccountId: owner.id,
    clientAddress: null,
    detail: { section: "ocr", keys: Object.keys(patch) },
  });
  return jsonOk({ ok: true });
});
