import { describe, expect, it } from "vitest";
import { parseQuantityInput, formatQuantity } from "@/lib/fractions";
import { aggregateIngredients, formatAggregatedItem } from "@/lib/shopping-lists/aggregate";
import type { Ingredient } from "@/types";

// ── parseQuantityInput ───────────────────────────────────────────────────────

describe("parseQuantityInput", () => {
  it("parses plain integers", () => {
    expect(parseQuantityInput("0")).toBe(0);
    expect(parseQuantityInput("2")).toBe(2);
    expect(parseQuantityInput("42")).toBe(42);
  });

  it("parses plain decimals", () => {
    expect(parseQuantityInput("1.5")).toBe(1.5);
    expect(parseQuantityInput("0.25")).toBe(0.25);
    expect(parseQuantityInput("3.14")).toBeCloseTo(3.14, 5);
  });

  it("parses European comma decimals", () => {
    expect(parseQuantityInput("1,5")).toBe(1.5);
    expect(parseQuantityInput("0,25")).toBe(0.25);
  });

  it("parses pure ASCII fractions", () => {
    expect(parseQuantityInput("1/2")).toBe(0.5);
    expect(parseQuantityInput("1/4")).toBe(0.25);
    expect(parseQuantityInput("3/4")).toBe(0.75);
    // snapQuantity rounds to 3 decimals: 1/3 → 0.333
    expect(parseQuantityInput("1/3")).toBe(0.333);
    expect(parseQuantityInput("5/8")).toBe(0.625);
  });

  it("parses mixed fractions", () => {
    expect(parseQuantityInput("1 1/2")).toBe(1.5);
    expect(parseQuantityInput("2 3/4")).toBe(2.75);
    expect(parseQuantityInput("3 1/4")).toBe(3.25);
    expect(parseQuantityInput("0 1/2")).toBe(0.5);
  });

  it("accepts whitespace around the slash", () => {
    expect(parseQuantityInput("1 / 2")).toBe(0.5);
    expect(parseQuantityInput("1/ 2")).toBe(0.5);
    expect(parseQuantityInput("1 /2")).toBe(0.5);
    expect(parseQuantityInput("3  /  4")).toBe(0.75);
  });

  it("parses Unicode fraction characters", () => {
    expect(parseQuantityInput("½")).toBe(0.5);
    expect(parseQuantityInput("¼")).toBe(0.25);
    expect(parseQuantityInput("¾")).toBe(0.75);
    // snapQuantity rounds to 3 decimals: ⅓ → 0.333
    expect(parseQuantityInput("⅓")).toBe(0.333);
    // snapQuantity: ⅔ → 0.667
    expect(parseQuantityInput("⅔")).toBe(0.667);
    expect(parseQuantityInput("⅛")).toBe(0.125);
    expect(parseQuantityInput("⅝")).toBe(0.625);
    expect(parseQuantityInput("⅞")).toBe(0.875);
  });

  it("parses mixed integer + Unicode fraction", () => {
    expect(parseQuantityInput("1½")).toBe(1.5);
    expect(parseQuantityInput("2¾")).toBe(2.75);
    expect(parseQuantityInput("1 ½")).toBe(1.5);
    expect(parseQuantityInput("3 ⅛")).toBe(3.125);
  });

  it("returns null for empty or blank input", () => {
    expect(parseQuantityInput("")).toBeNull();
    expect(parseQuantityInput("   ")).toBeNull();
    expect(parseQuantityInput("\t\n")).toBeNull();
  });

  it("returns null for unrecognised input", () => {
    expect(parseQuantityInput("abc")).toBeNull();
    expect(parseQuantityInput("1/0")).toBeNull();
    expect(parseQuantityInput("1/2abc")).toBeNull();
    expect(parseQuantityInput("abc1/2")).toBeNull();
    expect(parseQuantityInput("1.2.3")).toBeNull();
    expect(parseQuantityInput("1,2,3")).toBeNull();
    expect(parseQuantityInput("one")).toBeNull();
    expect(parseQuantityInput("/2")).toBeNull();
    expect(parseQuantityInput("2/")).toBeNull();
  });
});

// ── formatQuantity ───────────────────────────────────────────────────────────

describe("formatQuantity", () => {
  it("formats whole numbers as integers", () => {
    expect(formatQuantity(0)).toBe("0");
    expect(formatQuantity(1)).toBe("1");
    expect(formatQuantity(2)).toBe("2");
    expect(formatQuantity(42)).toBe("42");
  });

  it("formats common fractions correctly", () => {
    expect(formatQuantity(0.5)).toBe("1/2");
    expect(formatQuantity(0.25)).toBe("1/4");
    expect(formatQuantity(0.75)).toBe("3/4");
    expect(formatQuantity(0.2)).toBe("1/5");
    expect(formatQuantity(0.4)).toBe("2/5");
    expect(formatQuantity(0.6)).toBe("3/5");
    expect(formatQuantity(0.8)).toBe("4/5");
  });

  it("formats eighths", () => {
    expect(formatQuantity(0.125)).toBe("1/8");
    expect(formatQuantity(0.375)).toBe("3/8");
    expect(formatQuantity(0.625)).toBe("5/8");
    expect(formatQuantity(0.875)).toBe("7/8");
  });

  it("formats thirds and sixths", () => {
    expect(formatQuantity(1 / 3)).toBe("1/3");
    expect(formatQuantity(2 / 3)).toBe("2/3");
    expect(formatQuantity(1 / 6)).toBe("1/6");
    expect(formatQuantity(5 / 6)).toBe("5/6");
  });

  it("formats mixed numbers", () => {
    expect(formatQuantity(1.5)).toBe("1 1/2");
    expect(formatQuantity(2.25)).toBe("2 1/4");
    expect(formatQuantity(3.75)).toBe("3 3/4");
    expect(formatQuantity(1.125)).toBe("1 1/8");
    expect(formatQuantity(2.5)).toBe("2 1/2");
  });

  it("handles floating-point residue near whole numbers", () => {
    // 1/3 + 1/6 = 0.5 exactly, but verify typical FP results snap cleanly
    expect(formatQuantity(0.9999999)).toBe("1");
    expect(formatQuantity(1.0000001)).toBe("1");
    expect(formatQuantity(2 - 1e-10)).toBe("2");
    expect(formatQuantity(0 + 1e-10)).toBe("0");
  });

  it("displays non-matching values as clean decimals", () => {
    expect(formatQuantity(0.123)).toBe("0.123");
    expect(formatQuantity(0.42)).toBe("0.42");
    expect(formatQuantity(0.01)).toBe("0.01");
    expect(formatQuantity(1.234)).toBe("1.234");
  });

  it("handles negative values", () => {
    expect(formatQuantity(-0.5)).toBe("-1/2");
    expect(formatQuantity(-2)).toBe("-2");
    expect(formatQuantity(-1.25)).toBe("-1 1/4");
  });

  it("handles non-finite values", () => {
    expect(formatQuantity(NaN)).toBe("NaN");
    expect(formatQuantity(Infinity)).toBe("Infinity");
  });
});

// ── round-trip consistency ───────────────────────────────────────────────────

describe("round-trip: parseQuantityInput → formatQuantity", () => {
  it("round-trips through parse/format for fractions", () => {
    const inputs = ["1/2", "3/4", "1 1/2", "2 3/4", "0.5", "0.25", "1.75"];
    for (const input of inputs) {
      const parsed = parseQuantityInput(input);
      expect(parsed).not.toBeNull();
      const formatted = formatQuantity(parsed!);
      // Re-parse the formatted result to check consistency
      const reparsed = parseQuantityInput(formatted);
      expect(reparsed).toBe(parsed);
    }
  });
});

// ── shopping-list aggregation with fractions ─────────────────────────────────

describe("shopping aggregation with fractions", () => {
  const INGREDIENT = (qty: number, name: string, unit: string): Ingredient => ({
    id: "00000000-0000-4000-8000-000000000001",
    order: 0,
    quantity: qty,
    unit,
    name,
    note: null,
  });

  it("sums 1/3 + 1/6 to display as 1/2", () => {
    // parseQuantityInput snaps to 3 decimals: 1/3 → 0.333, 1/6 → 0.167
    // Sum: 0.333 + 0.167 = 0.5 → displayed as "1/2"
    const result = aggregateIngredients([
      { recipeId: "a", ingredients: [INGREDIENT(0.333, "flour", "cup")] },
      { recipeId: "b", ingredients: [INGREDIENT(0.167, "flour", "cup")] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.quantity).toBeCloseTo(0.5, 3);
    expect(formatAggregatedItem(result[0]!)).toBe("1/2 cup Flour");
  });

  it("sums 1/4 + 1/4 to display as 1/2", () => {
    const result = aggregateIngredients([
      { recipeId: "a", ingredients: [INGREDIENT(0.25, "sugar", "cup")] },
      { recipeId: "b", ingredients: [INGREDIENT(0.25, "sugar", "cup")] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.quantity).toBe(0.5);
    expect(formatAggregatedItem(result[0]!)).toBe("1/2 cup Sugar");
  });

  it("sums 1/2 + 1/4 to display as 3/4", () => {
    const result = aggregateIngredients([
      { recipeId: "a", ingredients: [INGREDIENT(0.5, "butter", "cup")] },
      { recipeId: "b", ingredients: [INGREDIENT(0.25, "butter", "cup")] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.quantity).toBe(0.75);
    expect(formatAggregatedItem(result[0]!)).toBe("3/4 cup Butter");
  });

  it("formats whole-number aggregated quantities as integers", () => {
    const result = aggregateIngredients([
      { recipeId: "a", ingredients: [INGREDIENT(1, "flour", "cup")] },
      { recipeId: "b", ingredients: [INGREDIENT(2, "flour", "cup")] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.quantity).toBe(3);
    expect(formatAggregatedItem(result[0]!)).toBe("3 cup Flour");
  });
});
