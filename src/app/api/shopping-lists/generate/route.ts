import { z } from "zod";
import { apiHandler, jsonOk, parseBody } from "@/lib/api";
import { assertWeekId } from "@/lib/ids";
import { requireCapability } from "@/lib/authorization/guards";
import { generateFromMealPlan } from "@/lib/shopping-lists/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  weekId: z.string(),
  name: z.string().max(120).optional(),
});

/** Generate a snapshot shopping list from the caller's own meal plan. */
export const POST = apiHandler(async (request) => {
  const account = await requireCapability("shoppingLists.use");
  const body = await parseBody(request, bodySchema);
  const list = await generateFromMealPlan(account, assertWeekId(body.weekId), body.name);
  return jsonOk({ id: list.id }, { status: 201 });
});
