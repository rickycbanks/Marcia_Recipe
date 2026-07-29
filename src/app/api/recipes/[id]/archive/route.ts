import { apiHandler, jsonOk } from "@/lib/api";
import { requireOwner } from "@/lib/authorization/guards";
import { assertUuid } from "@/lib/ids";
import { archiveRecipe, restoreRecipe } from "@/lib/recipes/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

/** Soft-delete (archive). Tombstones remain in historical meal plans. */
export const POST = apiHandler(async (_request, { params }: Params) => {
  const owner = await requireOwner();
  const { id } = await params;
  await archiveRecipe(owner, assertUuid(id));
  return jsonOk({ ok: true });
});

/** Restore from archive. */
export const DELETE = apiHandler(async (_request, { params }: Params) => {
  const owner = await requireOwner();
  const { id } = await params;
  await restoreRecipe(owner, assertUuid(id));
  return jsonOk({ ok: true });
});
