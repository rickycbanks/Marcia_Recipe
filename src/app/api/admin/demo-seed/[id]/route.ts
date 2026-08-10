import { apiHandler, jsonOk } from "@/lib/api";
import { requireOwner } from "@/lib/authorization/guards";
import { getRecipeForOwner } from "@/lib/recipes/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export const GET = apiHandler(async (_request, context) => {
  await requireOwner();
  const { id } = await context.params;
  const recipe = await getRecipeForOwner(id);
  return jsonOk(recipe);
});
