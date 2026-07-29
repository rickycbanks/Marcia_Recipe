import { apiHandler, jsonOk } from "@/lib/api";
import { badRequest, payloadTooLarge } from "@/lib/errors";
import { assertUuid } from "@/lib/ids";
import { requireOwner } from "@/lib/authorization/guards";
import { addMediaToRecipe } from "@/lib/media/service";
import { MEDIA_LIMITS } from "@/lib/validation/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

/** Owner-only image upload (multipart). Content is validated after decoding. */
export const POST = apiHandler(async (request, { params }: Params) => {
  const owner = await requireOwner();
  const { id } = await params;
  const form = await request.formData().catch(() => {
    throw badRequest("Expected multipart form data");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Missing image file");
  if (file.size > MEDIA_LIMITS.maxUploadBytes) throw payloadTooLarge("Image exceeds the size limit");
  const alt = String(form.get("alt") ?? "").slice(0, 200);
  const buffer = Buffer.from(await file.arrayBuffer());
  const item = await addMediaToRecipe(owner, assertUuid(id), buffer, alt);
  return jsonOk({ media: item }, { status: 201 });
});
