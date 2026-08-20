import { describe, expect, it } from "vitest";
import type { Recipe } from "@/types";
import { buildSuggestionIndex } from "@/lib/storage/indexes";

const NOW = "2026-01-01T00:00:00.000Z";

function recipe(partial: Partial<Recipe> = {}): Recipe {
  return {
    schemaVersion: 2,
    id: "00000000-0000-4000-8000-000000000001",
    slug: "test-recipe",
    previousSlugs: [],
    visibility: "public",
    title: "Test Recipe",
    description: "",
    prepMinutes: null,
    cookMinutes: null,
    servings: null,
    difficulty: null,
    category: null,
    tags: [],
    sourceUrl: null,
    bookTitle: null,
    bookAuthor: null,
    bookPage: null,
    ingredients: [],
    steps: [],
    notesMarkdown: "",
    media: [],
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  };
}

describe("buildSuggestionIndex", () => {
  it("returns all empty arrays for an empty recipe list", () => {
    const index = buildSuggestionIndex([]);
    expect(index.categories).toEqual([]);
    expect(index.tags).toEqual([]);
    expect(index.bookTitles).toEqual([]);
    expect(index.bookAuthors).toEqual([]);
    expect(index.ingredientUnits).toEqual([]);
    expect(index.ingredientNames).toEqual([]);
  });

  it("collects distinct categories, tags, bookTitles, and bookAuthors (dedup + sorted)", () => {
    const r1 = recipe({
      category: "Dinner",
      tags: ["quick", "italian"],
      bookTitle: "Joy of Cooking",
      bookAuthor: "Rombauer",
    });
    const r2 = recipe({
      category: "Dessert",
      tags: ["quick", "sweet"],
      bookTitle: "Joy of Cooking",
      bookAuthor: "Becker",
    });
    const r3 = recipe({
      category: "Dinner",
      tags: ["italian"],
      bookTitle: "Another Book",
    });

    const index = buildSuggestionIndex([r1, r2, r3]);

    expect(index.categories).toEqual(["Dessert", "Dinner"]);
    expect(index.tags).toEqual(["italian", "quick", "sweet"]);
    expect(index.bookTitles).toEqual(["Another Book", "Joy of Cooking"]);
    expect(index.bookAuthors).toEqual(["Becker", "Rombauer"]);
  });

  it("deduplicates ingredient units", () => {
    const r1 = recipe({
      ingredients: [
        { id: "a", order: 0, quantity: 1, unit: "cup", name: "flour", note: null },
        { id: "b", order: 1, quantity: 2, unit: "tbsp", name: "butter", note: null },
      ],
    });
    const r2 = recipe({
      ingredients: [
        { id: "c", order: 0, quantity: 1, unit: "cup", name: "sugar", note: null },
        { id: "d", order: 1, quantity: 3, unit: "tsp", name: "vanilla", note: null },
      ],
    });

    const index = buildSuggestionIndex([r1, r2]);
    expect(index.ingredientUnits).toEqual(["cup", "tbsp", "tsp"]);
  });

  it("sorts ingredient names by descending count, then alphabetically for ties", () => {
    const r1 = recipe({
      ingredients: [
        { id: "a", order: 0, quantity: 1, unit: "cup", name: "flour", note: null },
        { id: "b", order: 1, quantity: 1, unit: "tsp", name: "salt", note: null },
        { id: "c", order: 2, quantity: 1, unit: "cup", name: "sugar", note: null },
      ],
    });
    const r2 = recipe({
      ingredients: [
        { id: "d", order: 0, quantity: 1, unit: "cup", name: "flour", note: null },
        { id: "e", order: 1, quantity: 1, unit: "tsp", name: "baking soda", note: null },
      ],
    });
    const r3 = recipe({
      ingredients: [
        { id: "f", order: 0, quantity: 1, unit: "cup", name: "flour", note: null },
      ],
    });

    const index = buildSuggestionIndex([r1, r2, r3]);

    // flour: 3, baking soda: 1 (alphabetical before salt), salt: 1, sugar: 1
    expect(index.ingredientNames).toEqual(["flour", "baking soda", "salt", "sugar"]);
  });

  it("preserves first-seen casing on case-insensitive dedup", () => {
    const r1 = recipe({
      bookTitle: "Joy of Cooking",
      bookAuthor: "Rombauer",
    });
    const r2 = recipe({
      bookTitle: "joy of cooking",
      bookAuthor: "rombauer",
    });

    const index = buildSuggestionIndex([r1, r2]);

    // First-seen casing is preserved; since both map to the same lowercase
    // key, only the first occurrence is kept.
    expect(index.bookTitles).toEqual(["Joy of Cooking"]);
    expect(index.bookAuthors).toEqual(["Rombauer"]);
  });

  it("filters out whitespace-only and empty values", () => {
    const r = recipe({
      category: "   ",
      tags: [""],
      bookTitle: "",
      bookAuthor: "   ",
      ingredients: [
        { id: "a", order: 0, quantity: 1, unit: "   ", name: "flour", note: null },
        { id: "b", order: 1, quantity: 1, unit: "", name: "  ", note: null },
      ],
    });

    const index = buildSuggestionIndex([r]);

    expect(index.categories).toEqual([]);
    expect(index.tags).toEqual([]);
    expect(index.bookTitles).toEqual([]);
    expect(index.bookAuthors).toEqual([]);
    expect(index.ingredientUnits).toEqual([]);
    expect(index.ingredientNames).toEqual(["flour"]);
  });

  it("trims values so leading/trailing whitespace is removed and deduplicates", () => {
    const r1 = recipe({
      category: " Dinner ",
    });
    const r2 = recipe({
      category: "dinner",
    });

    const index = buildSuggestionIndex([r1, r2]);

    // Trimmed to "Dinner" first, then "dinner" deduplicates to it.
    expect(index.categories).toEqual(["Dinner"]);
  });

  it("handles null category/tags/bookTitle/bookAuthor gracefully", () => {
    const r = recipe({
      category: null,
      bookTitle: null,
      bookAuthor: null,
    });

    const index = buildSuggestionIndex([r]);
    expect(index.categories).toEqual([]);
    expect(index.bookTitles).toEqual([]);
    expect(index.bookAuthors).toEqual([]);
  });
});
