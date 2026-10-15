import { describe, expect, it } from "vitest";
import { normalizeLatexFractions } from "@/lib/imports/ocr";
import { mistralExtractionSchema, tryStructuredExtraction } from "@/lib/imports/providers/structuredRecipe";

describe("cookbook OCR conversion regressions", () => {
  it("normalizes actual OCR LaTeX fractions without losing whole numbers or line breaks", () => {
    expect(normalizeLatexFractions(
      "\\(1 \\frac{1}{2}\\) cups cucumber\n\\( \\frac{1}{2} \\) cup cream\n\\(1/4\\) cup oil",
    )).toBe("1 1/2 cups cucumber\n1/2 cup cream\n1/4 cup oil");
    expect(normalizeLatexFractions("\\(x + y\\)")).toBe("\\(x + y\\)");
  });

  // Conversion-path regression: model-shaped structured JSON through
  // tryStructuredExtraction. Does not exercise live OCR/extraction quality.
  it("converts structured JSON keeping measurements, qualifiers, and optional ingredients", () => {
    const draft = tryStructuredExtraction(JSON.stringify({
      title: "Sauce", prepMinutes: 10, cookMinutes: null, totalMinutes: 10, servings: null,
      ingredients: [
        { quantity: "1 1/2", unit: "cups", name: "peeled, seeded, and chopped cucumber", note: "see Tip" },
        { quantity: "⅓", unit: "cup", name: "chopped fresh cilantro leaves", note: "tightly packed" },
        { quantity: "1", unit: "clove", name: "garlic", note: "chopped" },
        { quantity: null, unit: null, name: "Honey", note: "for drizzling (optional)" },
      ],
      steps: ["Place the ingredients in a blender. Blend until smooth."],
      notes: "Makes 1 cup\n\nStore in the refrigerator for up to 2 days.\n\nLarge scoop makes 7 biscuits",
    }));
    expect(draft).not.toBeNull();
    expect(draft!.ingredients).toEqual([
      { quantity: 1.5, unit: "cups", name: "peeled, seeded, and chopped cucumber", note: "see Tip" },
      { quantity: 0.333, unit: "cup", name: "chopped fresh cilantro leaves", note: "tightly packed" },
      { quantity: 1, unit: "clove", name: "garlic", note: "chopped" },
      { quantity: null, unit: null, name: "Honey", note: "for drizzling (optional)" },
    ]);
    expect(draft!.steps).toEqual(["Place the ingredients in a blender. Blend until smooth."]);
    expect(draft!.cookMinutes).toBeNull();
    expect(draft!.servings).toBeNull();
    expect(draft!.notesMarkdown).toContain("Large scoop makes 7 biscuits");
    expect(draft!.notesMarkdown).toContain("Makes 1 cup");
  });

  it("requires explicit nullable ingredient fields in the strict Mistral schema", () => {
    const schema = mistralExtractionSchema() as {
      properties: Record<string, unknown> & { ingredients: { items: { properties: Record<string, unknown>; required: string[] } } };
      required: string[];
    };
    expect(schema.required.sort()).toEqual(Object.keys(schema.properties).sort());
    const ingredient = schema.properties.ingredients.items;
    expect(ingredient.required.sort()).toEqual(Object.keys(ingredient.properties).sort());
  });
});
