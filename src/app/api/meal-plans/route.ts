import { z } from "zod";
import { apiHandler, jsonOk, parseBody } from "@/lib/api";
import { assertUuid, assertWeekId } from "@/lib/ids";
import { isoWeekId } from "@/lib/time";
import { requireCapability } from "@/lib/authorization/guards";
import { MEAL_SLOTS } from "@/lib/validation/constants";
import {
  getOwnMealPlan,
  removeMealPlanEntry,
  saveMealPlanEntries,
} from "@/lib/meal-plans/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const entrySchema = z.object({
  day: z.number().int().min(0).max(6),
  slot: z.enum(MEAL_SLOTS),
  recipeId: z.string(),
  note: z.string().trim().max(200).nullable().default(null),
});

const putSchema = z.object({
  weekId: z.string(),
  entries: z.array(entrySchema).max(200),
});

const deleteSchema = z.object({
  weekId: z.string(),
  entryId: z.string(),
});

/** Read the caller's own plan for a week (`?week=2026-W30`, default current). */
export const GET = apiHandler(async (request) => {
  const account = await requireCapability("mealPlans.use");
  const { searchParams } = new URL(request.url);
  const weekParam = searchParams.get("week");
  const weekId = weekParam ? assertWeekId(weekParam) : isoWeekId();
  const plan = await getOwnMealPlan(account, weekId);
  return jsonOk({ plan });
});

/** Replace the caller's own weekly plan entries (all references re-validated). */
export const PUT = apiHandler(async (request) => {
  const account = await requireCapability("mealPlans.use");
  const body = await parseBody(request, putSchema);
  const weekId = assertWeekId(body.weekId);
  const entries = body.entries.map((e) => ({ ...e, recipeId: assertUuid(e.recipeId, "recipe id") }));
  const plan = await saveMealPlanEntries(account, weekId, entries);
  return jsonOk({ plan });
});

/** Remove one entry from the caller's own plan. */
export const DELETE = apiHandler(async (request) => {
  const account = await requireCapability("mealPlans.use");
  const body = await parseBody(request, deleteSchema);
  const plan = await removeMealPlanEntry(account, assertWeekId(body.weekId), assertUuid(body.entryId, "entry id"));
  return jsonOk({ plan });
});
