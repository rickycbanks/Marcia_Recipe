import { apiHandler, jsonOk } from "@/lib/api";
import { assertUuid } from "@/lib/ids";
import { requireOwner } from "@/lib/authorization/guards";
import { removeStagedMedia } from "@/lib/media/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ mediaId: string }>;
}

/** Owner-only discard of a staged image upload. */
export const DELETE = apiHandler(async (_request, { params }: Params) => {
  const owner = await requireOwner();
  const { mediaId } = await params;
  await removeStagedMedia(owner, assertUuid(mediaId));
  return jsonOk({ ok: true });
});
