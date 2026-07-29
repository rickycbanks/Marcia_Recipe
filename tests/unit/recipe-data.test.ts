import { describe, expect, it } from "vitest";
import { aggregateIngredients, formatAggregatedItem } from "@/lib/shopping-lists/aggregate";
import { parseIngredientLine, sanitizeText } from "@/lib/imports/textParsing";
import { parseRecipeText } from "@/lib/imports/ocr";
import { slugify } from "@/lib/ids";

describe("recipe data helpers", () => {
  it("creates stable slugs and parses ingredient quantities", () => {
    expect(slugify("Crème brûlée! ")).toBe("creme-brulee");
    expect(parseIngredientLine("1 1/2 cups flour")).toMatchObject({ quantity: 1.5, unit: "cups", name: "flour" });
    expect(sanitizeText("hello\u0000  world")).toBe("hello world");
  });

  it("aggregates compatible ingredients deterministically", () => {
    const result = aggregateIngredients([
      {
        recipeId: "b",
        ingredients: [
          { id: "00000000-0000-4000-8000-000000000002", order: 0, quantity: 1, unit: "cup", name: "Flour", note: null },
        ],
      },
      {
        recipeId: "a",
        ingredients: [
          { id: "00000000-0000-4000-8000-000000000003", order: 0, quantity: 2, unit: "cups", name: "flour", note: null },
        ],
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: "flour", quantity: 3, unit: "cup", recipeIds: ["a", "b"] });
    expect(formatAggregatedItem(result[0]!)).toBe("3 cup Flour");
  });

  it("extracts a reviewable OCR draft without persisting anything", () => {
    const draft = parseRecipeText("Tomato Pasta\nIngredients\n2 cups tomatoes\nInstructions\n1. Cook the pasta.");
    expect(draft.title).toBe("Tomato Pasta");
    expect(draft.ingredients).toHaveLength(1);
    expect(draft.steps).toEqual(["Cook the pasta."]);
  });
});
