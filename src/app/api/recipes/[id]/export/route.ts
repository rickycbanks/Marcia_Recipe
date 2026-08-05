import { apiHandler } from "@/lib/api";
import { getSessionAccount } from "@/lib/authorization/guards";
import { canViewRecipe } from "@/lib/authorization/visibility";
import { notFound } from "@/lib/errors";
import { recipeToMarkdown } from "@/lib/export/markdown";
import { getRecipe } from "@/lib/storage/repositories/recipes";
import { getSiteConfig } from "@/lib/storage/repositories/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Markdown download for anyone who can view the recipe (guests + owner),
 * matching the recipe detail page's visibility rules.
 */
export const GET = apiHandler(async (_request, { params }: Params) => {
  const account = await getSessionAccount();
  const { id } = await params;
  const recipe = await getRecipe(id);
  if (!recipe) throw notFound("Recipe not found");
  const config = await getSiteConfig();
  if (!canViewRecipe(recipe, config, account)) throw notFound("Recipe not found");
  const markdown = recipeToMarkdown(recipe);
  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${recipe.slug}.md"`,
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
});
