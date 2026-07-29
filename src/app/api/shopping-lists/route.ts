import { z } from "zod";
import { apiHandler, jsonOk, parseBody } from "@/lib/api";
import { requireCapability } from "@/lib/authorization/guards";
import { createShoppingList, listOwnShoppingLists } from "@/lib/shopping-lists/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({ name: z.string().trim().min(1).max(120) });

/** The caller's own lists (never anyone else's). */
export const GET = apiHandler(async () => {
  const account = await requireCapability("shoppingLists.use");
  const lists = await listOwnShoppingLists(account);
  return jsonOk({
    lists: lists.map(({ id, name, sourceMealPlanId, items, updatedAt }) => ({
      id,
      name,
      sourceMealPlanId,
      itemCount: items.length,
      checkedCount: items.filter((i) => i.checked).length,
      updatedAt,
    })),
  });
});

export const POST = apiHandler(async (request) => {
  const account = await requireCapability("shoppingLists.use");
  const body = await parseBody(request, createSchema);
  const list = await createShoppingList(account, body.name);
  return jsonOk({ id: list.id }, { status: 201 });
});
