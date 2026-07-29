import { z } from "zod";
import { apiHandler, jsonOk, parseBody } from "@/lib/api";
import { assertUuid } from "@/lib/ids";
import { requireCapability } from "@/lib/authorization/guards";
import {
  deleteShoppingList,
  getOwnShoppingList,
  patchShoppingList,
  type ShoppingListPatch,
} from "@/lib/shopping-lists/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("addItem"),
    text: z.string().trim().min(1).max(200),
    quantity: z.number().nonnegative().nullable().optional(),
    unit: z.string().max(30).nullable().optional(),
  }),
  z.object({ action: z.literal("toggleItem"), itemId: z.string(), checked: z.boolean() }),
  z.object({ action: z.literal("removeItem"), itemId: z.string() }),
  z.object({ action: z.literal("rename"), name: z.string().trim().min(1).max(120) }),
  z.object({ action: z.literal("clearChecked") }),
]);

export const GET = apiHandler(async (_request, { params }: Params) => {
  const account = await requireCapability("shoppingLists.use");
  const { id } = await params;
  const list = await getOwnShoppingList(account, assertUuid(id, "list id"));
  return jsonOk({ list });
});

export const PATCH = apiHandler(async (request, { params }: Params) => {
  const account = await requireCapability("shoppingLists.use");
  const { id } = await params;
  const body = await parseBody(request, patchSchema);
  const patch = { ...body, ...( "itemId" in body ? { itemId: assertUuid(body.itemId, "item id") } : {}) } as ShoppingListPatch;
  const list = await patchShoppingList(account, assertUuid(id, "list id"), patch);
  return jsonOk({ list });
});

export const DELETE = apiHandler(async (_request, { params }: Params) => {
  const account = await requireCapability("shoppingLists.use");
  const { id } = await params;
  await deleteShoppingList(account, assertUuid(id, "list id"));
  return jsonOk({ ok: true });
});
