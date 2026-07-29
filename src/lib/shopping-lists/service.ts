import { rm } from "node:fs/promises";
import type { Account, Ingredient, ShoppingList } from "@/types";
import { forbidden, notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { SCHEMA_VERSIONS } from "@/lib/validation/constants";
import { hasCapability } from "@/lib/authorization/capabilities";
import { canViewRecipe } from "@/lib/authorization/visibility";
import { withWriteLock } from "@/lib/storage/lock";
import { resolveWithin } from "@/lib/storage/paths";
import {
  getMealPlan,
  getShoppingList,
  listShoppingLists,
  saveShoppingList,
} from "@/lib/storage/repositories/mealPlans";
import { getRecipe } from "@/lib/storage/repositories/recipes";
import { getSiteConfig } from "@/lib/storage/repositories/config";
import { aggregateIngredients, formatAggregatedItem } from "./aggregate";

function requireListCapability(account: Account): void {
  if (!hasCapability(account, "shoppingLists.use")) {
    throw forbidden("Missing capability: shoppingLists.use");
  }
}

/** Lists are private per account: all paths derive from the caller's own id. */
export async function listOwnShoppingLists(account: Account): Promise<ShoppingList[]> {
  requireListCapability(account);
  return listShoppingLists(account.id);
}

export async function getOwnShoppingList(account: Account, listId: string): Promise<ShoppingList> {
  requireListCapability(account);
  const list = await getShoppingList(account.id, listId);
  if (!list) throw notFound("Shopping list not found");
  return list;
}

export async function createShoppingList(account: Account, name: string): Promise<ShoppingList> {
  requireListCapability(account);
  return withWriteLock(async () => {
    const now = nowIso();
    const list: ShoppingList = {
      schemaVersion: SCHEMA_VERSIONS.shoppingList,
      id: newId(),
      accountId: account.id,
      name: name.trim().slice(0, 120) || "Shopping list",
      sourceMealPlanId: null,
      items: [],
      createdAt: now,
      updatedAt: now,
    };
    await saveShoppingList(list);
    return list;
  });
}

/**
 * Generate a list from the caller's own meal plan. Items are SNAPSHOTS of
 * current recipe ingredients (with attribution) — later recipe edits never
 * silently alter saved lists.
 */
export async function generateFromMealPlan(account: Account, weekId: string, name?: string): Promise<ShoppingList> {
  requireListCapability(account);
  if (!hasCapability(account, "mealPlans.use")) {
    throw forbidden("Missing capability: mealPlans.use");
  }
  const config = await getSiteConfig();
  const plan = await getMealPlan(account.id, weekId);
  if (!plan) throw notFound("No meal plan for that week");

  const sources: { recipeId: string; ingredients: Ingredient[] }[] = [];
  const titles = new Map<string, string>();
  for (const entry of plan.entries) {
    const recipe = await getRecipe(entry.recipeId);
    if (!recipe || recipe.archivedAt !== null) continue;
    if (!canViewRecipe(recipe, config, account)) continue; // never leak hidden ingredients
    sources.push({ recipeId: recipe.id, ingredients: recipe.ingredients });
    titles.set(recipe.id, recipe.title);
  }
  const aggregated = aggregateIngredients(sources);
  const now = nowIso();
  const list: ShoppingList = {
    schemaVersion: SCHEMA_VERSIONS.shoppingList,
    id: newId(),
    accountId: account.id,
    name: name?.trim() || `Groceries for ${weekId}`,
    sourceMealPlanId: plan.id,
    items: aggregated.map((item) => ({
      id: newId(),
      text: formatAggregatedItem(item),
      quantity: item.quantity,
      unit: item.unit,
      checked: false,
      source: "generated",
      recipeId: item.recipeIds[0] ?? null,
      recipeTitle: item.recipeIds[0] ? (titles.get(item.recipeIds[0]!) ?? null) : null,
    })),
    createdAt: now,
    updatedAt: now,
  };
  await withWriteLock(() => saveShoppingList(list));
  return list;
}

export type ShoppingListPatch =
  | { action: "addItem"; text: string; quantity?: number | null; unit?: string | null }
  | { action: "toggleItem"; itemId: string; checked: boolean }
  | { action: "removeItem"; itemId: string }
  | { action: "rename"; name: string }
  | { action: "clearChecked" };

export async function patchShoppingList(account: Account, listId: string, patch: ShoppingListPatch): Promise<ShoppingList> {
  requireListCapability(account);
  return withWriteLock(async () => {
    const list = await getShoppingList(account.id, listId);
    if (!list) throw notFound("Shopping list not found");
    let items = [...list.items];
    let listName = list.name;
    switch (patch.action) {
      case "addItem":
        items.push({
          id: newId(),
          text: patch.text.trim().slice(0, 200),
          quantity: patch.quantity ?? null,
          unit: patch.unit ?? null,
          checked: false,
          source: "manual",
          recipeId: null,
          recipeTitle: null,
        });
        break;
      case "toggleItem":
        items = items.map((i) => (i.id === patch.itemId ? { ...i, checked: patch.checked } : i));
        break;
      case "removeItem":
        items = items.filter((i) => i.id !== patch.itemId);
        break;
      case "rename":
        listName = patch.name.trim().slice(0, 120) || list.name;
        break;
      case "clearChecked":
        items = items.filter((i) => !i.checked);
        break;
    }
    const updated: ShoppingList = { ...list, name: listName, items, updatedAt: nowIso() };
    await saveShoppingList(updated);
    return updated;
  });
}

export async function deleteShoppingList(account: Account, listId: string): Promise<void> {
  requireListCapability(account);
  await withWriteLock(async () => {
    const list = await getShoppingList(account.id, listId);
    if (!list) throw notFound("Shopping list not found");
    await rm(resolveWithin("users", account.id, "shopping-lists", `${list.id}.json`), { force: true });
  });
}

