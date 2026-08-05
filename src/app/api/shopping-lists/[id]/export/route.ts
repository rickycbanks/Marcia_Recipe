import { apiHandler } from "@/lib/api";
import { requireCapability } from "@/lib/authorization/guards";
import { notFound } from "@/lib/errors";
import { shoppingListToMarkdown } from "@/lib/export/markdown";
import { getShoppingList } from "@/lib/storage/repositories/mealPlans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

/** Markdown download of the caller's own shopping list. */
export const GET = apiHandler(async (_request, { params }: Params) => {
  const account = await requireCapability("shoppingLists.use");
  const { id } = await params;
  const list = await getShoppingList(account.id, id);
  if (!list) throw notFound("Shopping list not found");
  const filename = `shopping-list-${list.name.replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}.md`;
  const markdown = shoppingListToMarkdown(list);
  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
});
