import { apiHandler } from "@/lib/api";
import { requireCapability } from "@/lib/authorization/guards";
import { notFound } from "@/lib/errors";
import { mealPlanToMarkdown, type RecipeRef } from "@/lib/export/markdown";
import { assertWeekId } from "@/lib/ids";
import { getMealPlan } from "@/lib/storage/repositories/mealPlans";
import { getRecipe } from "@/lib/storage/repositories/recipes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ weekId: string }>;
}

/** Markdown download of the caller's own weekly meal plan. */
export const GET = apiHandler(async (_request, { params }: Params) => {
  const account = await requireCapability("mealPlans.use");
  const { weekId } = await params;
  const plan = await getMealPlan(account.id, assertWeekId(weekId));
  if (!plan) throw notFound("Meal plan not found");

  // Collect recipe references; missing recipes render as tombstones.
  const recipeIds = [...new Set(plan.entries.map((e) => e.recipeId))];
  const recipeRefs = new Map<string, RecipeRef>();
  for (const recipeId of recipeIds) {
    const recipe = await getRecipe(recipeId);
    if (!recipe) continue;
    recipeRefs.set(recipe.id, {
      id: recipe.id,
      title: recipe.title,
      slug: recipe.slug,
      archived: recipe.archivedAt !== null,
    });
  }

  const markdown = mealPlanToMarkdown(plan, recipeRefs);
  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="meal-plan-${weekId}.md"`,
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
});
