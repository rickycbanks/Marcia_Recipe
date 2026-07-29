import type { Ingredient } from "@/types";

/**
 * Deterministic ingredient normalization + aggregation for shopping-list
 * generation. Pure functions — heavily unit tested.
 */

const UNIT_ALIASES: Record<string, string> = {
  gram: "g", grams: "g", g: "g",
  kilogram: "kg", kilograms: "kg", kg: "kg",
  milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml", ml: "ml",
  liter: "l", liters: "l", litre: "l", litres: "l", l: "l",
  tablespoon: "tbsp", tablespoons: "tbsp", tbsp: "tbsp",
  teaspoon: "tsp", teaspoons: "tsp", tsp: "tsp",
  cup: "cup", cups: "cup",
  ounce: "oz", ounces: "oz", oz: "oz",
  pound: "lb", pounds: "lb", lb: "lb", lbs: "lb",
  pinch: "pinch", pinches: "pinch",
  clove: "clove", cloves: "clove",
  can: "can", cans: "can",
  package: "pkg", packages: "pkg", pkg: "pkg",
  bunch: "bunch", bunches: "bunch",
  slice: "slice", slices: "slice",
  piece: "piece", pieces: "piece",
};

export function normalizeUnit(unit: string | null): string | null {
  if (!unit) return null;
  const key = unit.trim().toLowerCase().replace(/\.$/, "");
  if (!key) return null;
  return UNIT_ALIASES[key] ?? key;
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface AggregatedItem {
  name: string;
  quantity: number | null;
  unit: string | null;
  /** Recipe ids that contributed, in first-seen order (attribution). */
  recipeIds: string[];
}

/**
 * Combine ingredients across recipes: same normalized (name, unit) sums
 * quantities; unquantified entries merge by name. Output ordering is
 * deterministic: by name, then unit.
 */
export function aggregateIngredients(
  sources: { recipeId: string; ingredients: Ingredient[] }[],
): AggregatedItem[] {
  const byKey = new Map<string, AggregatedItem & { sortName: string; sortUnit: string }>();
  const orderedSources = [...sources].sort((a, b) => a.recipeId.localeCompare(b.recipeId));

  for (const { recipeId, ingredients } of orderedSources) {
    const ordered = [...ingredients].sort((a, b) => a.order - b.order);
    for (const ingredient of ordered) {
      const name = normalizeName(ingredient.name);
      if (!name) continue;
      const unit = normalizeUnit(ingredient.unit);
      const quantified = ingredient.quantity !== null;
      const key = quantified ? `${name}|${unit ?? ""}` : `${name}|<none>`;
      const existing = byKey.get(key);
      if (existing) {
        if (quantified) existing.quantity = (existing.quantity ?? 0) + (ingredient.quantity ?? 0);
        if (!existing.recipeIds.includes(recipeId)) existing.recipeIds.push(recipeId);
      } else {
        byKey.set(key, {
          name,
          quantity: quantified ? ingredient.quantity : null,
          unit: quantified ? unit : null,
          recipeIds: [recipeId],
          sortName: name,
          sortUnit: unit ?? "",
        });
      }
    }
  }

  return [...byKey.values()]
    .sort((a, b) => a.sortName.localeCompare(b.sortName) || a.sortUnit.localeCompare(b.sortUnit))
    .map(({ name, quantity, unit, recipeIds }) => ({ name, quantity, unit, recipeIds }));
}

/** Human label for an aggregated item, e.g. "400 g spaghetti". */
export function formatAggregatedItem(item: AggregatedItem): string {
  const qty = item.quantity !== null ? formatQuantity(item.quantity) : null;
  return [qty, item.unit, titleCase(item.name)].filter(Boolean).join(" ");
}

export function formatQuantity(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2).replace(/\.?0+$/, "");
}

function titleCase(value: string): string {
  return value.length > 0 ? value[0]!.toUpperCase() + value.slice(1) : value;
}
