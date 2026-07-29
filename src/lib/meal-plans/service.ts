import type { Account, MealPlan } from "@/types";
import { forbidden, notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { SCHEMA_VERSIONS } from "@/lib/validation/constants";
import { mealPlanEntrySchema } from "@/lib/validation/schemas";
import type { z } from "zod";
import { hasCapability } from "@/lib/authorization/capabilities";
import { canViewRecipe } from "@/lib/authorization/visibility";
import { withWriteLock } from "@/lib/storage/lock";
import { getMealPlan, listMealPlans, saveMealPlan } from "@/lib/storage/repositories/mealPlans";
import { getRecipe } from "@/lib/storage/repositories/recipes";
import { getSiteConfig } from "@/lib/storage/repositories/config";

export type MealPlanEntryInput = Omit<z.infer<typeof mealPlanEntrySchema>, "id">;

function requirePlannerCapability(account: Account): void {
  if (!hasCapability(account, "mealPlans.use")) {
    throw forbidden("Missing capability: mealPlans.use");
  }
}

/** Plans are private: they only ever live beneath the caller's own account id. */
export async function getOwnMealPlan(account: Account, weekId: string): Promise<MealPlan> {
  requirePlannerCapability(account);
  const existing = await getMealPlan(account.id, weekId);
  if (existing) return existing;
  const now = nowIso();
  return {
    schemaVersion: SCHEMA_VERSIONS.mealPlan,
    id: newId(),
    accountId: account.id,
    weekId,
    entries: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Replace a week's entries. Every referenced recipe must exist and be
 * viewable by the caller (prevents planting references to hidden recipes).
 */
export async function saveMealPlanEntries(
  account: Account,
  weekId: string,
  entries: MealPlanEntryInput[],
): Promise<MealPlan> {
  requirePlannerCapability(account);
  const config = await getSiteConfig();
  for (const entry of entries) {
    const recipe = await getRecipe(entry.recipeId);
    if (!recipe || recipe.archivedAt !== null || !canViewRecipe(recipe, config, account)) {
      throw forbidden("A referenced recipe does not exist or is not visible to you");
    }
  }
  return withWriteLock(async () => {
    const existing = await getMealPlan(account.id, weekId);
    const now = nowIso();
    const plan: MealPlan = {
      schemaVersion: SCHEMA_VERSIONS.mealPlan,
      id: existing?.id ?? newId(),
      accountId: account.id,
      weekId,
      entries: entries.map((e) => ({ ...e, id: newId() })),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await saveMealPlan(plan);
    return plan;
  });
}

export async function removeMealPlanEntry(account: Account, weekId: string, entryId: string): Promise<MealPlan> {
  requirePlannerCapability(account);
  return withWriteLock(async () => {
    const existing = await getMealPlan(account.id, weekId);
    if (!existing) throw notFound("Meal plan not found");
    const plan: MealPlan = {
      ...existing,
      entries: existing.entries.filter((e) => e.id !== entryId),
      updatedAt: nowIso(),
    };
    await saveMealPlan(plan);
    return plan;
  });
}

export async function listOwnMealPlans(account: Account): Promise<MealPlan[]> {
  requirePlannerCapability(account);
  return listMealPlans(account.id);
}
