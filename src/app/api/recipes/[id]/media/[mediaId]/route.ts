import { apiHandler, jsonOk } from "@/lib/api";
import { assertUuid } from "@/lib/ids";
import { requireOwner } from "@/lib/authorization/guards";
import { removeMediaFromRecipe } from "@/lib/media/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string; mediaId: string }>;
}

/** Owner-only media removal. */
export const DELETE = apiHandler(async (_request, { params }: Params) => {
  const owner = await requireOwner();
  const { id, mediaId } = await params;
  await removeMediaFromRecipe(owner, assertUuid(id), assertUuid(mediaId));
  return jsonOk({ ok: true });
});
