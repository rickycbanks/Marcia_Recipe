import type { MealPlan, ShoppingList } from "@/types";
import { assertUuid, assertWeekId } from "@/lib/ids";
import { mealPlanSchema, shoppingListSchema } from "@/lib/validation/schemas";
import { readJson, writeJsonAtomic } from "../atomic";
import { resolveWithin } from "../paths";
import { listDocuments } from "../repo";

/**
 * Meal plans and shopping lists are private per-account data. Every path is
 * built from the *authenticated* account id, so cross-account access is
 * structurally impossible (there is no API that accepts an arbitrary owner id).
 */
const mealPlansDir = (accountId: string) =>
  resolveWithin("users", assertUuid(accountId, "account id"), "meal-plans");
const mealPlanPath = (accountId: string, weekId: string) =>
  resolveWithin(
    "users",
    assertUuid(accountId, "account id"),
    "meal-plans",
    `${assertWeekId(weekId)}.json`,
  );

export async function getMealPlan(accountId: string, weekId: string): Promise<MealPlan | null> {
  return readJson(mealPlanPath(accountId, weekId), mealPlanSchema);
}

export async function listMealPlans(accountId: string): Promise<MealPlan[]> {
  return listDocuments(mealPlansDir(accountId), mealPlanSchema);
}

export async function saveMealPlan(plan: MealPlan): Promise<void> {
  await writeJsonAtomic(mealPlanPath(plan.accountId, plan.weekId), mealPlanSchema.parse(plan));
}

const shoppingListsDir = (accountId: string) =>
  resolveWithin("users", assertUuid(accountId, "account id"), "shopping-lists");
const shoppingListPath = (accountId: string, listId: string) =>
  resolveWithin(
    "users",
    assertUuid(accountId, "account id"),
    "shopping-lists",
    `${assertUuid(listId, "list id")}.json`,
  );

export async function getShoppingList(accountId: string, listId: string): Promise<ShoppingList | null> {
  return readJson(shoppingListPath(accountId, listId), shoppingListSchema);
}

export async function listShoppingLists(accountId: string): Promise<ShoppingList[]> {
  const lists = await listDocuments(shoppingListsDir(accountId), shoppingListSchema);
  return lists.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveShoppingList(list: ShoppingList): Promise<void> {
  await writeJsonAtomic(shoppingListPath(list.accountId, list.id), shoppingListSchema.parse(list));
}
