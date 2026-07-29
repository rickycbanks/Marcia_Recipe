import { z } from "zod";
import { apiHandler, jsonOk, parseBody } from "@/lib/api";
import { requireOwner } from "@/lib/authorization/guards";
import { assertUuid } from "@/lib/ids";
import { recipeDraftSchema } from "@/lib/validation/schemas";
import { deleteRecipePermanently, updateRecipe } from "@/lib/recipes/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

/** Owner-only full update. */
export const PATCH = apiHandler(async (request, { params }: Params) => {
  const owner = await requireOwner();
  const { id } = await params;
  const draft = await parseBody(request, recipeDraftSchema);
  const recipe = await updateRecipe(owner, assertUuid(id), draft);
  return jsonOk({ id: recipe.id, slug: recipe.slug });
});

const deleteSchema = z.object({ confirm: z.literal(true) });

/** Permanent delete (blocked while meal-plan references exist; must be archived first). */
export const DELETE = apiHandler(async (request, { params }: Params) => {
  const owner = await requireOwner();
  const { id } = await params;
  await parseBody(request, deleteSchema);
  await deleteRecipePermanently(owner, assertUuid(id));
  return jsonOk({ ok: true });
});
