"use client";

import { useState } from "react";
import type { Ingredient } from "@/types";
import { formatQuantity, scaleQuantity } from "@/lib/fractions";

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
 * Ingredient list with a batch-size dropdown at the top. Selecting a size
 * rescales every ingredient quantity (and the servings hint) client-side;
 * nothing is persisted back to storage.
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
          .map((ingredient) => (
            <li key={ingredient.id} className="flex gap-2 text-sm">
              <span aria-hidden className="text-accent">•</span>
              <span>
                {ingredient.quantity !== null ? (
                  <strong>{formatQuantity(scaleQuantity(ingredient.quantity, multiplier))}</strong>
                ) : null}
                {ingredient.unit ? ` ${ingredient.unit}` : null}
                {ingredient.quantity !== null || ingredient.unit ? " " : ""}
                {ingredient.name}
                {ingredient.note ? <span className="text-muted-foreground">, {ingredient.note}</span> : null}
              </span>
            </li>
          ))}
      </ul>
    </>
  );
}
