"use client";

import { useState } from "react";
import type { Ingredient } from "@/types";
import { formatQuantity, scaleQuantity } from "@/lib/fractions";
import { normalizeMeasure } from "@/lib/units";

/**
 * Batch multipliers offered on the recipe detail page. `value` doubles as the
 * `<option>` value and the quantity multiplier applied to every ingredient.
 */
const BATCH_OPTIONS = [
  { value: 0.5, label: "Half batch (x0.5)" },
  { value: 1, label: "Original" },
  { value: 2, label: "Double batch (x2)" },
  { value: 3, label: "Triple batch (x3)" },
  { value: 4, label: "Quadruple batch (x4)" },
] as const;

interface Props {
  ingredients: Ingredient[];
  servings: number | null;
}

/**
 * Display quantity + unit for one ingredient: the stored quantity is scaled
 * by the batch multiplier and then normalized to the friendliest kitchen
 * unit (e.g. 3 tsp at x2 shows as 2 tbsp). Unquantified rows show the stored
 * unit as-is.
 */
function displayMeasure(ingredient: Ingredient, multiplier: number) {
  if (ingredient.quantity === null) return { quantity: null, unit: ingredient.unit };
  const { quantity, unit } = normalizeMeasure(
    ingredient.quantity,
    ingredient.unit,
    multiplier,
  );
  return { quantity, unit };
}

/**
 * Ingredient list with a batch-size dropdown at the top. Selecting a size
 * rescales every ingredient quantity (and the servings hint) client-side,
 * and quantities are normalized to friendly kitchen units for display
 * (e.g. 3 tsp shows as 1 tbsp). Nothing is persisted back to storage.
 */
export function IngredientList({ ingredients, servings }: Props) {
  const [multiplier, setMultiplier] = useState<number>(1);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="batch-size" className="font-medium text-muted-foreground">
          Batch size
        </label>
        <select
          id="batch-size"
          className="input w-auto"
          value={multiplier}
          onChange={(e) => setMultiplier(Number(e.target.value))}
        >
          {BATCH_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {servings !== null && multiplier !== 1 ? (
          <span className="text-muted-foreground">
            makes about {formatQuantity(scaleQuantity(servings, multiplier))} servings
          </span>
        ) : null}
      </div>
      <ul className="flex flex-col gap-1.5">
        {[...ingredients]
          .sort((a, b) => a.order - b.order)
          .map((ingredient) => {
            const measure = displayMeasure(ingredient, multiplier);
            return (
              <li key={ingredient.id} className="flex gap-2 text-sm">
                <span aria-hidden className="text-accent">•</span>
                <span>
                  {measure.quantity !== null ? (
                    <strong>{formatQuantity(measure.quantity)}</strong>
                  ) : null}
                  {measure.unit ? ` ${measure.unit}` : null}
                  {measure.quantity !== null || measure.unit ? " " : ""}
                  {ingredient.name}
                  {ingredient.note ? <span className="text-muted-foreground">, {ingredient.note}</span> : null}
                </span>
              </li>
            );
          })}
      </ul>
    </>
  );
}
