import { describe, expect, it } from "vitest";
import { parseRecipeText } from "@/lib/imports/ocr";

describe("parseRecipeText markdown sections", () => {
  it("keeps generic headings out of the title and parses section metadata", () => {
    const markdown = `# Orchard Skillet Cakes
## Description
Short description.
- 2 servings of context
## Yield
Makes 6 cakes
## Total Time
30 minutes
## Prep Time
10 minutes
## Cook Time
20 minutes
## Ingredients
- 1 cup grain-free flour
- 2 tablespoons neutral oil
- 1 medium fruit
- 1 teaspoon leavener
## Instructions
1. Combine dry ingredients.
2. Add wet ingredients.
3. Cook in a skillet.
## Notes
Serve warm.`;

    const draft = parseRecipeText(markdown);

    expect(draft.title).toBe("Orchard Skillet Cakes");
    expect(draft.title).not.toBe("Description");
    expect(draft.servings).toBe(6);
    expect(draft.prepMinutes).toBe(10);
    expect(draft.cookMinutes).toBe(20);
    expect(draft.ingredients).toHaveLength(4);
    expect(draft.steps).toHaveLength(3);
    expect(draft.notesMarkdown).toContain("Serve warm");
  });

  it("does not use Description as a title when no title heading exists", () => {
    const markdown = `## Description
Orchard Skillet Cakes
Short description.
## Ingredients
- 1 cup flour
- 2 eggs
## Instructions
1. Mix.
2. Cook.`;

    const draft = parseRecipeText(markdown);

    expect(draft.title).toBe("Orchard Skillet Cakes");
    expect(draft.title).not.toBe("Description");
  });

  it("parses divider-delimited Jina markdown without inventing servings", () => {
    const markdown = `Title: Orchard Skillet Cakes
URL Source: https://example.test/pancakes
Markdown Content:
### Description
A short pancake description.
* * *
**Pancakes**
* 3/4 cup [full fat coconut milk](https://example.test/coconut)
* 1 tsp vanilla extract
* 1 medium banana
* coconut oil for frying
* * *
1. Combine the ingredients.
2. Heat a skillet.
3. Cook the cakes.
### Notes
* Serve warm.
* Prep Time:10 minutes
* Cook Time:20 minutes`;

    const draft = parseRecipeText(markdown);

    expect(draft.title).toBe("Orchard Skillet Cakes");
    expect(draft.prepMinutes).toBe(10);
    expect(draft.cookMinutes).toBe(20);
    expect(draft.servings).toBeNull();
    expect(draft.ingredients).toHaveLength(4);
    expect(draft.ingredients).toContainEqual({ quantity: 0.75, unit: "cup", name: "full fat coconut milk", note: null });
    expect(draft.steps).toHaveLength(3);
    expect(draft.steps).not.toContain("Prep Time:10 minutes");
    expect(draft.steps).not.toContain("Cook Time:20 minutes");
  });
});

describe("parseRecipeText heuristic fallback", () => {
  it("returns an empty draft for empty input", () => {
    const draft = parseRecipeText("");
    expect(draft.title).toBe("");
    expect(draft.ingredients).toHaveLength(0);
    expect(draft.steps).toHaveLength(0);
  });

  it("parses classic ingredient/steps headers", () => {
    const text = `Pancakes
Ingredients:
1 cup flour
2 eggs
1 cup milk
Instructions:
1. Mix everything.
2. Cook in a pan.`;

    const draft = parseRecipeText(text);
    expect(draft.title).toBe("Pancakes");
    expect(draft.ingredients.length).toBeGreaterThan(0);
    expect(draft.steps.length).toBeGreaterThan(0);
  });
});
