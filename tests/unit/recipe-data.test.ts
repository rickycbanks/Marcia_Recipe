import { describe, expect, it, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aggregateIngredients, formatAggregatedItem } from "@/lib/shopping-lists/aggregate";
import { parseIngredientLine, parseMinutesFromText, sanitizeText } from "@/lib/imports/textParsing";
import { normalizeLatexFractions, normalizeTesseractFractions, parseRecipeText } from "@/lib/imports/ocr";
import { extractRecipeFromHtml } from "@/lib/imports/parse";
import { slugify } from "@/lib/ids";
import { resetEnvCache } from "@/lib/env";
import { ensureDataRoot, getDataRoot } from "@/lib/storage/dataRoot";
import { attachStagedMediaToRecipe } from "@/lib/media/service";

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

describe("parseMinutesFromText", () => {
  it("converts human-readable durations to minutes", () => {
    expect(parseMinutesFromText("10 minutes")).toBe(10);
    expect(parseMinutesFromText("10 mins")).toBe(10);
    expect(parseMinutesFromText("1 hour 30 minutes")).toBe(90);
    expect(parseMinutesFromText("2 hours")).toBe(120);
    expect(parseMinutesFromText("1 hr 15 mins")).toBe(75);
  });

  it("returns null for unparseable text", () => {
    expect(parseMinutesFromText("garbage")).toBeNull();
    expect(parseMinutesFromText("")).toBeNull();
  });
});

describe("parseRecipeText with Mistral markdown", () => {
  // ACTUAL live Mistral OCR output: no bullet markers, LaTeX-escaped
  // fractions, a roman-numeral first step, and a note fragmented across lines.
  const CRANBERRY_MARKDOWN = `# Cranberry BBQ Sauce

1 HOUR

MAKES 3 CUPS

2 tablespoons avocado oil
1 onion, chopped
6 garlic cloves, minced
3 cups cranberries, fresh or frozen (about 10 ounces)
\\(1 / 4\\) cup apple cider vinegar
\\(1 / 4\\) cup honey
\\(1 / 2\\) cup pumpkin puree
2 teaspoons molasses
1 teaspoon smoked sea salt
\\(1 / 2\\) cup water, plus more if needed

VARIATION: You can

substitute fresh or frozen

cherries for the cranberries

in this recipe—just cut the

honey by half, as cherries are

naturally sweeter.

I. Heat the oil in a medium saucepan over medium heat. When the pan is hot, add the onion and cook, stirring, for 5 minutes. Add two-thirds of the garlic and cook for another minute, or until fragrant, reserving the remaining garlic for adding raw at the end of the recipe.
2. Add the cranberries, vinegar, honey, pumpkin, molasses, and salt. Cover and simmer for 10 minutes, or until the cranberries have popped and softened. Turn off the heat, add the water, and allow to cool for about 15 minutes.
3. Carefully transfer the mixture along with the remaining raw garlic to a blender and blend on high speed until smooth. If your mixture is too thick, add water 1 tablespoon at a time until the desired consistency is reached.
4. Serve right away or transfer to a storage container. The sauce will keep for up to 1 week in the refrigerator; it also freezes well.`;

  it("parses full Mistral markdown into a clean draft", () => {
    const draft = parseRecipeText(CRANBERRY_MARKDOWN);
    expect(draft.title).toBe("Cranberry BBQ Sauce");
    expect(draft.ingredients).toHaveLength(10);
    expect(draft.ingredients[0]).toMatchObject({ quantity: 2, unit: "tablespoons", name: "avocado oil" });
    expect(draft.ingredients).toContainEqual({
      quantity: 0.25,
      unit: "cup",
      name: "apple cider vinegar",
      note: null,
    });
    expect(draft.steps).toHaveLength(4); // roman-numeral "I." step must be included
    expect(draft.steps[0]).toMatch(/^Heat the oil/);
    expect(draft.servings).toBe(3);
    expect(draft.cookMinutes).toBe(60);
    expect(draft.notesMarkdown).toContain("VARIATION");
    expect(draft.notesMarkdown).toContain("cherries");
    // Fragmented note lines must be rejoined into a single paragraph.
    expect(draft.notesMarkdown.split("\n\n").filter((block) => block.trim())).toHaveLength(1);
    // Metadata lines must not leak into ingredients or steps.
    expect(draft.ingredients.some((i) => i.name.toLowerCase() === "hour")).toBe(false);
    expect(draft.steps.some((s) => s.includes("VARIATION"))).toBe(false);
  });

  it("normalizes LaTeX-escaped fractions", () => {
    expect(normalizeLatexFractions("\\(1 / 4\\)")).toBe("1/4");
    expect(normalizeLatexFractions("\\(1 / 2\\)")).toBe("1/2");
    expect(normalizeLatexFractions("\\(3 / 4\\)")).toBe("3/4");
    expect(normalizeLatexFractions("\\(1/4\\) cup")).toBe("1/4 cup");
    expect(normalizeLatexFractions("plain text")).toBe("plain text");
  });

  it("parses a pure fraction like 1/4 as a quantity", () => {
    expect(parseIngredientLine("1/4 cup apple cider vinegar")).toMatchObject({
      quantity: 0.25,
      unit: "cup",
      name: "apple cider vinegar",
    });
    expect(parseIngredientLine("1/2 cup water")).toMatchObject({ quantity: 0.5, unit: "cup", name: "water" });
  });

  it("captures roman numeral step markers", () => {
    const draft = parseRecipeText("# Roman Steps\n- 1 cup flour\nI. Step one\nII. Step two");
    expect(draft.title).toBe("Roman Steps");
    expect(draft.ingredients).toHaveLength(1);
    expect(draft.steps).toEqual(["Step one", "Step two"]);
  });

  it("parses minimal markdown with a heading, bullets, and numbered steps", () => {
    const draft = parseRecipeText(
      "# Simple Salad\n- 1 cup lettuce\n- 2 tbsp olive oil\n1. Wash the lettuce.\n2. Toss with the oil.",
    );
    expect(draft.title).toBe("Simple Salad");
    expect(draft.ingredients).toHaveLength(2);
    expect(draft.ingredients[0]).toMatchObject({ quantity: 1, unit: "cup", name: "lettuce" });
    expect(draft.steps).toEqual(["Wash the lettuce.", "Toss with the oil."]);
  });

  it("parses markdown without a heading, falling back to the first line as title", () => {
    const draft = parseRecipeText(
      "Granola Bars\n- 2 cups oats\n- 1 cup honey\n1. Mix everything.\n2. Bake at 350 degrees for 20 minutes.",
    );
    expect(draft.title).toBe("Granola Bars");
    expect(draft.ingredients).toHaveLength(2);
    expect(draft.steps).toHaveLength(2);
  });

  it("still uses the guess heuristic for text with no markdown structure", () => {
    const draft = parseRecipeText("Lentil Soup\n1 cup lentils\n2 cups water\nSimmer until tender.");
    expect(draft.title).toBe("Lentil Soup");
    expect(draft.ingredients).toHaveLength(2);
    expect(draft.steps).toEqual(["Simmer until tender."]);
  });
});

describe("normalizeTesseractFractions", () => {
  it("fixes common Tesseract misreads of unicode fractions", () => {
    expect(normalizeTesseractFractions("Va cup")).toBe("1/4 cup");
    expect(normalizeTesseractFractions("% cup")).toBe("1/4 cup");
    expect(normalizeTesseractFractions("1% cup")).toBe("1/2 cup");
    expect(normalizeTesseractFractions("1 1 /2 cup")).toBe("1/2 cup");
    expect(normalizeTesseractFractions("1/ 2 cup")).toBe("1/2 cup");
    expect(normalizeTesseractFractions("1 /4 cup")).toBe("1/4 cup");
  });

  it("leaves plain text unaffected", () => {
    expect(normalizeTesseractFractions("1 onion, chopped")).toBe("1 onion, chopped");
    expect(normalizeTesseractFractions("2 tablespoons avocado oil")).toBe("2 tablespoons avocado oil");
    expect(normalizeTesseractFractions("1/2 cup honey")).toBe("1/2 cup honey");
  });
});

describe("parseRecipeText with Tesseract two-column output", () => {
  const INTERLEAVED = `Cranberry BBQ Sauce
1 HOUR
MAKES 3 CUPS
2 tablespoons avocado oil 1. Heat the oil in a medium saucepan over medium heat.
1 onion, chopped is hot, add the onion and cook, stirring, for 5 minutes.
6 garlic cloves, minced the garlic and cook for another minute.
3 cups cranberries, fresh or frozen
1/4 cup apple cider vinegar 2. Add the cranberries, vinegar, honey, and salt.
1/4 cup honey Cover and simmer for 10 minutes.
1/2 cup pumpkin puree
2 teaspoons molasses 3. Carefully transfer the mixture to a blender.
1 teaspoon smoked sea salt
1/2 cup water, plus more if needed 4. Serve right away or transfer to a storage container.
VARIATION: You can substitute fresh or frozen cherries for the cranberries.`;

  it("splits interleaved ingredient/step lines into a clean draft", () => {
    const draft = parseRecipeText(INTERLEAVED);
    expect(draft.title).toBe("Cranberry BBQ Sauce");
    expect(draft.ingredients.length).toBeGreaterThanOrEqual(8);
    expect(draft.ingredients[0]).toMatchObject({ quantity: 2, unit: "tablespoons", name: "avocado oil" });
    expect(draft.steps).toHaveLength(4);
    expect(draft.steps[0]).toMatch(/^Heat the oil/);
    expect(draft.servings).toBe(3);
    expect(draft.cookMinutes).toBe(60);
    expect(draft.notesMarkdown).toContain("VARIATION");
    expect(draft.notesMarkdown).toContain("cherries");
    // Step text must not leak into ingredient names.
    expect(draft.ingredients.some((i) => i.name.includes("Heat the oil"))).toBe(false);
    expect(draft.ingredients.some((i) => i.name.includes("Add the cranberries"))).toBe(false);
  });

  it("recognizes the 'l.' misread of step 1's marker", () => {
    const draft = parseRecipeText(
      "Cranberry BBQ Sauce\n1 HOUR\nMAKES 3 CUPS\n2 tablespoons avocado oil l. Heat the oil in a medium saucepan.\n1 onion, chopped",
    );
    expect(draft.title).toBe("Cranberry BBQ Sauce");
    expect(draft.steps).toEqual(["Heat the oil in a medium saucepan."]);
    expect(draft.ingredients[0]).toMatchObject({ quantity: 2, unit: "tablespoons", name: "avocado oil" });
  });

  it("filters mostly-punctuation garbage lines out of title, ingredients, and steps", () => {
    const draft = parseRecipeText(
      "Cranberry BBQ Sauce\nVv a i ) cel ! ' 3 . | . . ' . : ES or\n2 tablespoons avocado oil 1. Heat the oil in a medium saucepan.",
    );
    expect(draft.title).toBe("Cranberry BBQ Sauce");
    expect(draft.ingredients).toHaveLength(1);
    expect(draft.ingredients[0]).toMatchObject({ quantity: 2, unit: "tablespoons", name: "avocado oil" });
    expect(draft.steps).toEqual(["Heat the oil in a medium saucepan."]);
    expect(draft.title).not.toContain("Vv");
    expect(draft.steps.join(" ")).not.toContain("Vv");
  });
});

describe("WP Recipe Maker extraction", () => {
  const WPRM_HTML = `<html><body>
    <div class="wprm-recipe wprm-recipe-template-test">
      <h2 class="wprm-recipe-name">Test Recipe</h2>
      <div class="wprm-recipe-summary">A test summary.</div>
      <ul>
        <li class="wprm-recipe-ingredient"><span class="wprm-recipe-ingredient-amount">1 ½</span> <span class="wprm-recipe-ingredient-unit">cup</span> <span class="wprm-recipe-ingredient-name">flour</span></li>
        <li class="wprm-recipe-ingredient"><span class="wprm-recipe-ingredient-amount">2</span> <span class="wprm-recipe-ingredient-unit">tbsp</span> <span class="wprm-recipe-ingredient-name">sugar</span></li>
      </ul>
      <div class="wprm-recipe-instruction-text">Mix the dry ingredients.</div>
      <div class="wprm-recipe-instruction-text">Bake for 30 minutes.</div>
      <span class="wprm-recipe-servings">4</span>
      <span class="wprm-recipe-prep-time" datetime="PT10M">10 minutes</span>
      <span class="wprm-recipe-cook-time" datetime="PT30M">30 minutes</span>
      <span class="wprm-recipe-keywords">dessert, easy</span>
      <span class="wprm-recipe-course">Dessert</span>
    </div>
  </body></html>`;

  it("extracts a draft from a wprm-recipe HTML fragment", () => {
    const result = extractRecipeFromHtml(WPRM_HTML, "https://example.com/recipe");
    expect(result).not.toBeNull();
    expect(result!.via).toBe("wprm");
    expect(result!.draft.title).toBe("Test Recipe");
    expect(result!.draft.description).toBe("A test summary.");
    expect(result!.draft.ingredients).toHaveLength(2);
    expect(result!.draft.ingredients[0]).toMatchObject({ quantity: 1.5, unit: "cup", name: "flour" });
    expect(result!.draft.steps).toEqual(["Mix the dry ingredients.", "Bake for 30 minutes."]);
    expect(result!.draft.servings).toBe(4);
    expect(result!.draft.prepMinutes).toBe(10);
    expect(result!.draft.cookMinutes).toBe(30);
    expect(result!.draft.category).toBe("Dessert");
    expect(result!.draft.tags).toEqual(["dessert", "easy"]);
    expect(result!.draft.sourceUrl).toBe("https://example.com/recipe");
  });

  it("returns null for pages without a wprm-recipe container", () => {
    expect(extractRecipeFromHtml("<html><body><p>no recipe</p></body></html>", null)).toBeNull();
  });
});

describe("staged media attach", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    delete process.env.DATA_ROOT;
    resetEnvCache();
    root = undefined;
  });

  const NOW = "2026-01-01T00:00:00.000Z";
  const OWNER = "00000000-0000-4000-8000-0000000000ee";

  /** Write a sidecar + webp pair straight into tmp/staged-media (no sharp pipeline). */
  async function stage(id: string, alt: string, dir: string): Promise<void> {
    const sidecar = {
      id,
      fileName: `${id}.webp`,
      alt,
      width: 800,
      height: 600,
      bytes: 1234,
      isPrimary: false,
      createdAt: NOW,
      ownerAccountId: OWNER,
    };
    await writeFile(join(dir, `${id}.json`), JSON.stringify(sidecar), "utf8");
    await writeFile(join(dir, `${id}.webp`), `bytes-${id}`, "utf8");
  }

  it("moves staged media into the recipe media dir and marks the first item primary", async () => {
    root = await mkdtemp(join(tmpdir(), "marcia-recipe-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await ensureDataRoot();

    const stagedDir = join(getDataRoot(), "tmp", "staged-media");
    await mkdir(stagedDir, { recursive: true });
    const idA = "00000000-0000-4000-8000-0000000000a1";
    const idB = "00000000-0000-4000-8000-0000000000b2";
    await stage(idA, "First", stagedDir);
    await stage(idB, "Second", stagedDir);

    const recipeId = "00000000-0000-4000-8000-0000000000c3";
    const media = await attachStagedMediaToRecipe(recipeId, [idA, idB], true);

    expect(media).toHaveLength(2);
    expect(media[0]).toMatchObject({
      id: idA,
      alt: "First",
      isPrimary: true,
      fileName: `${idA}.webp`,
      createdAt: NOW,
    });
    expect(media[1]).toMatchObject({ id: idB, alt: "Second", isPrimary: false });

    // WebP files moved into the recipe media dir; sidecars removed after attach.
    await expect(readFile(join(getDataRoot(), "recipes", recipeId, "media", `${idA}.webp`), "utf8")).resolves.toBe(
      `bytes-${idA}`,
    );
    await expect(readFile(join(getDataRoot(), "recipes", recipeId, "media", `${idB}.webp`), "utf8")).resolves.toBe(
      `bytes-${idB}`,
    );
    await expect(readFile(join(stagedDir, `${idA}.json`), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("skips missing staged media without aborting", async () => {
    root = await mkdtemp(join(tmpdir(), "marcia-recipe-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await ensureDataRoot();

    const stagedDir = join(getDataRoot(), "tmp", "staged-media");
    await mkdir(stagedDir, { recursive: true });
    const idA = "00000000-0000-4000-8000-0000000000a1";
    const missing = "00000000-0000-4000-8000-0000000000f4";
    await stage(idA, "Only", stagedDir);

    const recipeId = "00000000-0000-4000-8000-0000000000c3";
    const media = await attachStagedMediaToRecipe(recipeId, [missing, idA], true);

    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({ id: idA, isPrimary: true });
  });
});
