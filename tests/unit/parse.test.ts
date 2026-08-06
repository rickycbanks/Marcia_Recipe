import { describe, expect, it } from "vitest";
import { extractRecipeFromHtml } from "@/lib/imports/parse";

describe("extractRecipeFromHtml JSON-LD selection", () => {
  it("selects the most complete Recipe node from a JSON-LD graph", () => {
    const jsonLd = {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "Recipe", name: "Description" },
        {
          "@type": "Recipe",
          name: "AIP Banana Pancakes",
          recipeYield: ["8", "8-10 small pancakes"],
          prepTime: "PT10M",
          cookTime: "PT20M",
          recipeIngredient: ["2 bananas", "1 cup cassava flour", "2 eggs"],
          recipeInstructions: [
            {
              "@type": "HowToSection",
              itemListElement: [
                { "@type": "HowToStep", text: "Mash the bananas." },
                { "@type": "HowToStep", text: "Cook the pancakes." },
              ],
            },
          ],
        },
      ],
    };
    const html = `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;

    const result = extractRecipeFromHtml(html, "https://example.com/pancakes");

    expect(result).not.toBeNull();
    expect(result!.via).toBe("json-ld");
    expect(result!.draft.title).toBe("AIP Banana Pancakes");
    expect(result!.draft.title).not.toBe("Description");
    expect(result!.draft.servings).toBe(8);
    expect(result!.draft.prepMinutes).toBe(10);
    expect(result!.draft.cookMinutes).toBe(20);
    expect(result!.draft.ingredients).toHaveLength(3);
    expect(result!.draft.steps).toHaveLength(2);
  });

  it("falls back to WPRM when JSON-LD has no recipe evidence", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: "JSON-LD title only",
    })}</script>
      <div class="wprm-recipe">
        <h2 class="wprm-recipe-name">WPRM Pancakes</h2>
        <ul><li class="wprm-recipe-ingredient">1 cup flour</li></ul>
        <div class="wprm-recipe-instruction-text">Mix and cook.</div>
      </div>`;

    const result = extractRecipeFromHtml(html, "https://example.com/pancakes");

    expect(result).not.toBeNull();
    expect(result!.via).toBe("wprm");
    expect(result!.draft.title).toBe("WPRM Pancakes");
  });
});
