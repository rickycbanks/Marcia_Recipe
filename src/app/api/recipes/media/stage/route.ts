import { apiHandler, jsonOk } from "@/lib/api";
import { badRequest, payloadTooLarge } from "@/lib/errors";
import { requireOwner } from "@/lib/authorization/guards";
import { stageMediaUpload } from "@/lib/media/service";
import { MEDIA_LIMITS } from "@/lib/validation/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner-only staged image upload (multipart). Processed to WebP and held in
 * tmp/staged-media until the recipe is created, then attached atomically.
 */
export const POST = apiHandler(async (request) => {
  const owner = await requireOwner();
  const form = await request.formData().catch(() => {
    throw badRequest("Expected multipart form data");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Missing image file");
  if (file.size > MEDIA_LIMITS.maxUploadBytes) throw payloadTooLarge("Image exceeds the size limit");
  const alt = String(form.get("alt") ?? "").slice(0, 200);
  const buffer = Buffer.from(await file.arrayBuffer());
  const item = await stageMediaUpload(owner, buffer, alt);
  return jsonOk({ media: item }, { status: 201 });
});
