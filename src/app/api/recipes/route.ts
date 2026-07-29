import { apiHandler, jsonOk, parseBody } from "@/lib/api";
import { requireOwner } from "@/lib/authorization/guards";
import { recipeDraftSchema } from "@/lib/validation/schemas";
import { createRecipe } from "@/lib/recipes/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Owner-only recipe creation. */
export const POST = apiHandler(async (request) => {
  const owner = await requireOwner();
  const draft = await parseBody(request, recipeDraftSchema);
  const recipe = await createRecipe(owner, draft);
  return jsonOk({ id: recipe.id, slug: recipe.slug }, { status: 201 });
});
