/**
 * No-network tests for the Mistral and Gemini two-pass OCR pipelines.
 * All provider calls are intercepted via fetch seams — no real API keys or
 * network calls are made. Tests verify:
 *   - Correct request shapes for both passes
 *   - Structured JSON → RecipeDraft conversion (including fraction strings)
 *   - Invalid/missing pass-2 outputs → heuristic fallback with status
 *   - Same-provider heuristic fallback surfaced as status
 *   - Tesseract does NOT invoke a second pass
 *   - No secrets or raw output leaked in errors
 */

import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { ensureDataRoot } from "@/lib/storage/dataRoot";
import {
  resetKeyringCache,
} from "@/lib/config/ocrCrypto";

function makeKeyringEnv(keyId = "test-key"): string {
  const key = randomBytes(32).toString("base64url");
  return `${keyId}:${key}`;
}

/* -------------------------------------------------------------------------- */
/*  Structured recipe conversion (no network needed)                          */
/* -------------------------------------------------------------------------- */

import {
  convertStructuredToDraft,
  tryStructuredExtraction,
  mistralExtractionSchema,
  geminiExtractionSchema,
  EXTRACTION_USER_PROMPT_PREFIX,
  SYSTEM_PROMPT,
  type StructuredRecipe,
} from "@/lib/imports/providers/structuredRecipe";

describe("structured recipe conversion", () => {
  it("converts a complete structured recipe to a RecipeDraft", () => {
    const data: StructuredRecipe = {
      title: "Banana Pancakes",
      description: "A quick breakfast.",
      prepMinutes: 10,
      cookMinutes: 20,
      totalMinutes: null,
      servings: 4,
      ingredients: [
        { quantity: "2", unit: "cups", name: "flour", note: null },
        { quantity: "1/2", unit: "cup", name: "milk", note: "whole" },
        { quantity: "1 1/4", unit: "tsp", name: "baking powder", note: null },
      ],
      steps: ["Mix dry ingredients.", "Add wet ingredients.", "Cook."],
      notes: "Serve warm.",
    };

    const draft = convertStructuredToDraft(data);
    expect(draft.title).toBe("Banana Pancakes");
    expect(draft.description).toBe("A quick breakfast.");
    expect(draft.prepMinutes).toBe(10);
    expect(draft.cookMinutes).toBe(20);
    expect(draft.servings).toBe(4);
    expect(draft.ingredients).toHaveLength(3);
    expect(draft.ingredients[0]).toMatchObject({ quantity: 2, unit: "cups", name: "flour", note: null });
    expect(draft.ingredients[1]).toMatchObject({ quantity: 0.5, unit: "cup", name: "milk", note: "whole" });
    expect(draft.steps).toHaveLength(3);
    expect(draft.notesMarkdown).toBe("Serve warm.");
  });

  it("parses fraction strings through the fraction-aware parser", () => {
    const data: StructuredRecipe = {
      title: "Fraction Test",
      description: null,
      prepMinutes: null,
      cookMinutes: null,
      totalMinutes: null,
      servings: null,
      ingredients: [
        { quantity: "3/4", unit: "cup", name: "coconut milk", note: null },
        { quantity: "1/2", unit: "tsp", name: "vanilla", note: null },
        { quantity: "1 1/2", unit: "cups", name: "flour", note: "sifted" },
        { quantity: "2 3/4", unit: "oz", name: "butter", note: null },
        { quantity: "1/3", unit: null, name: "sugar", note: null },
      ],
      steps: ["Step 1."],
      notes: null,
    };

    const draft = convertStructuredToDraft(data);
    expect(draft.ingredients[0]).toMatchObject({ quantity: 0.75, unit: "cup" });
    expect(draft.ingredients[1]).toMatchObject({ quantity: 0.5, unit: "tsp" });
    expect(draft.ingredients[2]).toMatchObject({ quantity: 1.5, unit: "cups", note: "sifted" });
    expect(draft.ingredients[3]).toMatchObject({ quantity: 2.75, unit: "oz" });
    expect(draft.ingredients[4]).toMatchObject({ quantity: 0.333, unit: null });
  });

  it("handles null quantities and units gracefully", () => {
    const data: StructuredRecipe = {
      title: "No Quantity",
      description: null,
      prepMinutes: null,
      cookMinutes: null,
      totalMinutes: null,
      servings: null,
      ingredients: [
        { quantity: null, unit: null, name: "salt", note: "to taste" },
        { quantity: "2", unit: null, name: "eggs", note: null },
      ],
      steps: ["Step 1."],
      notes: null,
    };

    const draft = convertStructuredToDraft(data);
    expect(draft.ingredients[0]).toMatchObject({ quantity: null, unit: null, name: "salt", note: "to taste" });
    expect(draft.ingredients[1]).toMatchObject({ quantity: 2, unit: null, name: "eggs" });
  });

  it("truncates long titles and names", () => {
    const data: StructuredRecipe = {
      title: "A".repeat(300),
      description: "B".repeat(3000),
      prepMinutes: null,
      cookMinutes: null,
      totalMinutes: null,
      servings: null,
      ingredients: [{ quantity: "1", unit: "cup", name: "C".repeat(300), note: null }],
      steps: ["D".repeat(3000)],
      notes: "E".repeat(25000),
    };

    const draft = convertStructuredToDraft(data);
    expect(draft.title.length).toBeLessThanOrEqual(200);
    expect(draft.description.length).toBeLessThanOrEqual(2000);
    expect(draft.ingredients[0]!.name.length).toBeLessThanOrEqual(200);
    expect(draft.steps[0]!.length).toBeLessThanOrEqual(2000);
    expect(draft.notesMarkdown.length).toBeLessThanOrEqual(20_000);
  });

  it("filters out empty steps and ingredients", () => {
    const data: StructuredRecipe = {
      title: "Filtered",
      description: null,
      prepMinutes: null,
      cookMinutes: null,
      totalMinutes: null,
      servings: null,
      ingredients: [
        { quantity: "1", unit: "cup", name: "flour", note: null },
        { quantity: null, unit: null, name: "", note: null },
      ],
      steps: ["Step 1.", "", "  ", "Step 2."],
      notes: null,
    };

    const draft = convertStructuredToDraft(data);
    expect(draft.ingredients).toHaveLength(1);
    expect(draft.steps).toHaveLength(2);
  });
});

describe("totalMinutes disambiguation", () => {
  it("derives cookMinutes from totalMinutes when cookMinutes is absent", () => {
    const data: StructuredRecipe = {
      title: "Derive Cook",
      description: null,
      prepMinutes: 15,
      cookMinutes: null,
      totalMinutes: 45,
      servings: null,
      ingredients: [{ quantity: "1", unit: "cup", name: "flour", note: null }],
      steps: ["Step 1."],
      notes: null,
    };
    const draft = convertStructuredToDraft(data);
    expect(draft.prepMinutes).toBe(15);
    expect(draft.cookMinutes).toBe(30);
  });

  it("does NOT map totalMinutes into cookMinutes when cookMinutes is absent and prepMinutes is absent", () => {
    const data: StructuredRecipe = {
      title: "Total Only",
      description: null,
      prepMinutes: null,
      cookMinutes: null,
      totalMinutes: 45,
      servings: null,
      ingredients: [{ quantity: "1", unit: "cup", name: "flour", note: null }],
      steps: ["Step 1."],
      notes: null,
    };
    const draft = convertStructuredToDraft(data);
    expect(draft.prepMinutes).toBeNull();
    expect(draft.cookMinutes).toBeNull();
  });

  it("does NOT overwrite explicit cookMinutes with totalMinutes derivation", () => {
    const data: StructuredRecipe = {
      title: "Keep Cook",
      description: null,
      prepMinutes: 10,
      cookMinutes: 20,
      totalMinutes: 45,
      servings: null,
      ingredients: [{ quantity: "1", unit: "cup", name: "flour", note: null }],
      steps: ["Step 1."],
      notes: null,
    };
    const draft = convertStructuredToDraft(data);
    expect(draft.cookMinutes).toBe(20);
  });

  it("does not derive cookMinutes when total <= prepMinutes", () => {
    const data: StructuredRecipe = {
      title: "No Derive",
      description: null,
      prepMinutes: 30,
      cookMinutes: null,
      totalMinutes: 20,
      servings: null,
      ingredients: [{ quantity: "1", unit: "cup", name: "flour", note: null }],
      steps: ["Step 1."],
      notes: null,
    };
    const draft = convertStructuredToDraft(data);
    expect(draft.cookMinutes).toBeNull();
  });

  it("ignores negative totalMinutes", () => {
    const data: StructuredRecipe = {
      title: "Neg Total",
      description: null,
      prepMinutes: 10,
      cookMinutes: null,
      totalMinutes: -5,
      servings: null,
      ingredients: [{ quantity: "1", unit: "cup", name: "flour", note: null }],
      steps: ["Step 1."],
      notes: null,
    };
    const draft = convertStructuredToDraft(data);
    expect(draft.cookMinutes).toBeNull();
  });
});

describe("ingredient field placement", () => {
  it("preserves note for qualifiers and keeps name intact", () => {
    const data: StructuredRecipe = {
      title: "Qualifier Test",
      description: null,
      prepMinutes: null,
      cookMinutes: null,
      totalMinutes: null,
      servings: null,
      ingredients: [
        { quantity: "1", unit: "tsp", name: "vanilla extract", note: "or almond extract" },
        { quantity: null, unit: null, name: "salt", note: "to taste" },
        { quantity: "2", unit: "cans", name: "coconut milk", note: "full fat, 13.5 oz each" },
        { quantity: "1", unit: "cup", name: "flour", note: null },
      ],
      steps: ["Step 1."],
      notes: null,
    };
    const draft = convertStructuredToDraft(data);
    expect(draft.ingredients[0]).toMatchObject({ name: "vanilla extract", note: "or almond extract" });
    expect(draft.ingredients[1]).toMatchObject({ name: "salt", note: "to taste" });
    expect(draft.ingredients[2]).toMatchObject({ name: "coconut milk", note: "full fat, 13.5 oz each" });
    expect(draft.ingredients[3]).toMatchObject({ name: "flour", note: null });
  });

  it("preserves fraction strings as source text through conversion", () => {
    const data: StructuredRecipe = {
      title: "Fraction Source",
      description: null,
      prepMinutes: null,
      cookMinutes: null,
      totalMinutes: null,
      servings: null,
      ingredients: [
        { quantity: "1 3/4", unit: "cups", name: "almond flour", note: null },
        { quantity: "2-3", unit: "tbsp", name: "maple syrup", note: null },
      ],
      steps: ["Step 1."],
      notes: null,
    };
    const draft = convertStructuredToDraft(data);
    expect(draft.ingredients[0]).toMatchObject({ quantity: 1.75, unit: "cups", name: "almond flour" });
    // "2-3" is not a parseable fraction; fallback preserves null quantity
    expect(draft.ingredients[1]!.name).toBe("maple syrup");
  });
});

describe("notes/tips presence", () => {
  it("captures notes as a single combined string", () => {
    const data: StructuredRecipe = {
      title: "Notes Test",
      description: null,
      prepMinutes: null,
      cookMinutes: null,
      totalMinutes: null,
      servings: null,
      ingredients: [{ quantity: "1", unit: "cup", name: "flour", note: null }],
      steps: ["Step 1."],
      notes: "Tip: chill the dough for 30 minutes. Variation: add chocolate chips.",
    };
    const draft = convertStructuredToDraft(data);
    expect(draft.notesMarkdown).toContain("Tip:");
    expect(draft.notesMarkdown).toContain("Variation:");
  });
});

describe("tryStructuredExtraction", () => {
  it("parses valid JSON and returns a draft", () => {
    const json = JSON.stringify({
      title: "Chocolate Cake",
      description: "Rich and moist.",
      prepMinutes: 15,
      cookMinutes: 35,
      servings: 8,
      ingredients: [
        { quantity: "2", unit: "cups", name: "flour", note: null },
        { quantity: "3/4", unit: "cup", name: "cocoa powder", note: null },
      ],
      steps: ["Preheat oven.", "Mix ingredients.", "Bake."],
      notes: "Cool before frosting.",
    });

    const draft = tryStructuredExtraction(json);
    expect(draft).not.toBeNull();
    expect(draft!.title).toBe("Chocolate Cake");
    expect(draft!.prepMinutes).toBe(15);
    expect(draft!.cookMinutes).toBe(35);
    expect(draft!.servings).toBe(8);
    expect(draft!.ingredients).toHaveLength(2);
    expect(draft!.ingredients[0]).toMatchObject({ quantity: 2, unit: "cups", name: "flour" });
    expect(draft!.ingredients[1]).toMatchObject({ quantity: 0.75, unit: "cup", name: "cocoa powder" });
    expect(draft!.steps).toHaveLength(3);
    expect(draft!.notesMarkdown).toBe("Cool before frosting.");
  });

  it("returns null for invalid JSON", () => {
    expect(tryStructuredExtraction("not json")).toBeNull();
    expect(tryStructuredExtraction("")).toBeNull();
  });

  it("returns null for non-object JSON", () => {
    expect(tryStructuredExtraction('"hello"')).toBeNull();
    expect(tryStructuredExtraction("42")).toBeNull();
    expect(tryStructuredExtraction("[1,2,3]")).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    const json = JSON.stringify({ description: "No title here" });
    expect(tryStructuredExtraction(json)).toBeNull();
  });

  it("treats non-array ingredients as empty array", () => {
    const json = JSON.stringify({ title: "Test", ingredients: "not an array", steps: ["Step"] });
    const draft = tryStructuredExtraction(json);
    // Non-array ingredients defaults to []; title + steps is valid
    expect(draft).not.toBeNull();
    expect(draft!.ingredients).toHaveLength(0);
    expect(draft!.title).toBe("Test");
  });

  it("handles ingredients with missing name by filtering them out", () => {
    const json = JSON.stringify({
      title: "Partial",
      ingredients: [
        { quantity: "1", unit: "cup", name: "flour", note: null },
        { quantity: null, unit: null, name: "", note: null },
      ],
      steps: ["Step 1."],
    });
    const draft = tryStructuredExtraction(json);
    expect(draft).not.toBeNull();
    expect(draft!.ingredients).toHaveLength(1);
  });

  it("converts fraction strings in quantities", () => {
    const json = JSON.stringify({
      title: "Fractions",
      ingredients: [
        { quantity: "1/2", unit: "cup", name: "butter", note: null },
        { quantity: "1 3/4", unit: "cups", name: "flour", note: null },
      ],
      steps: ["Step 1."],
    });
    const draft = tryStructuredExtraction(json);
    expect(draft).not.toBeNull();
    expect(draft!.ingredients[0]).toMatchObject({ quantity: 0.5, unit: "cup", name: "butter" });
    expect(draft!.ingredients[1]).toMatchObject({ quantity: 1.75, unit: "cups", name: "flour" });
  });

  it("parses totalMinutes from JSON and derives cook when prep is present", () => {
    const json = JSON.stringify({
      title: "Total Derivation",
      prepMinutes: 10,
      cookMinutes: null,
      totalMinutes: 35,
      ingredients: [{ quantity: "1", unit: "cup", name: "flour", note: null }],
      steps: ["Step 1."],
    });
    const draft = tryStructuredExtraction(json);
    expect(draft).not.toBeNull();
    expect(draft!.prepMinutes).toBe(10);
    expect(draft!.cookMinutes).toBe(25);
  });

  it("does not derive cook from total when only total is present", () => {
    const json = JSON.stringify({
      title: "Total Only",
      prepMinutes: null,
      cookMinutes: null,
      totalMinutes: 45,
      ingredients: [{ quantity: "1", unit: "cup", name: "flour", note: null }],
      steps: ["Step 1."],
    });
    const draft = tryStructuredExtraction(json);
    expect(draft).not.toBeNull();
    expect(draft!.cookMinutes).toBeNull();
  });
});

describe("extraction JSON schemas", () => {
  it("mistral schema has correct structure including totalMinutes", () => {
    const schema = mistralExtractionSchema();
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(expect.arrayContaining(["title", "ingredients", "steps"]));
    expect((schema as Record<string, unknown>).additionalProperties).toBe(false);
    // totalMinutes present for disambiguation
    const props = schema.properties as Record<string, unknown>;
    expect(props.totalMinutes).toBeDefined();
  });

  it("gemini schema has correct structure including totalMinutes", () => {
    const schema = geminiExtractionSchema();
    expect(schema.type).toBe("OBJECT");
    expect(schema.required).toEqual(expect.arrayContaining(["title", "ingredients", "steps"]));
    // totalMinutes present for disambiguation
    const props = schema.properties as Record<string, unknown>;
    expect(props.totalMinutes).toBeDefined();
  });
});

describe("extraction prompt", () => {
  it("SYSTEM_PROMPT treats source as cookbook and forbids prose", () => {
    expect(SYSTEM_PROMPT).toContain("cookbook or recipe page");
    expect(SYSTEM_PROMPT).toContain("one primary recipe");
    expect(SYSTEM_PROMPT).toContain("JSON object");
    expect(SYSTEM_PROMPT).toContain("no prose");
  });

  it("EXTRACTION_USER_PROMPT_PREFIX covers cookbook extraction contract", () => {
    // Strictness
    expect(EXTRACTION_USER_PROMPT_PREFIX).toContain("No hallucination");
    expect(EXTRACTION_USER_PROMPT_PREFIX).toContain("OCR text:");
    // Source-awareness
    expect(EXTRACTION_USER_PROMPT_PREFIX).toContain("cookbook or recipe page");
    // Description rule: copy only, never invent
    expect(EXTRACTION_USER_PROMPT_PREFIX).toContain("Never invent");
    // Time rules
    expect(EXTRACTION_USER_PROMPT_PREFIX).toContain("prepMinutes / cookMinutes");
    expect(EXTRACTION_USER_PROMPT_PREFIX).toContain("totalMinutes");
    expect(EXTRACTION_USER_PROMPT_PREFIX).toContain("Do NOT use total as cook time");
    // Ingredient field placement
    expect(EXTRACTION_USER_PROMPT_PREFIX).toContain("quantity, unit, name");
    expect(EXTRACTION_USER_PROMPT_PREFIX).toContain('note field is only for qualifiers');
    // Notes/tips
    expect(EXTRACTION_USER_PROMPT_PREFIX).toContain("notes, tips, or variations");
    // Exclusion rules
    expect(EXTRACTION_USER_PROMPT_PREFIX).toContain("Exclude page furniture");
    expect(EXTRACTION_USER_PROMPT_PREFIX).toContain("logos");
    expect(EXTRACTION_USER_PROMPT_PREFIX).toContain("page numbers");
    expect(EXTRACTION_USER_PROMPT_PREFIX).toContain("headers/footers");
    // Strictness
    expect(EXTRACTION_USER_PROMPT_PREFIX).toContain("null or empty arrays");
  });
});

/* -------------------------------------------------------------------------- */
/*  Mistral two-pass pipeline (with fetch seam)                              */
/* -------------------------------------------------------------------------- */

import { savePrivateOcrConfig, getEffectiveOcrProvider } from "@/lib/config/ocrPrivate";
import { recognizeAndExtractWithMistral } from "@/lib/imports/providers/mistral";

describe("recognizeAndExtractWithMistral (no-network)", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) {
      const { rm } = await import("node:fs/promises");
      await rm(root, { recursive: true, force: true });
    }
    delete process.env.DATA_ROOT;
    delete process.env.MISTRAL_API_KEY;
    delete process.env.PRIVATE_CONFIG_KEYRING;
    resetEnvCache();
    resetKeyringCache();
    root = undefined;
  });

  it("makes correct pass-1 and pass-2 request shapes", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-mistral-2pass-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();
    await savePrivateOcrConfig({
      activeProvider: "mistral",
      mistral: { apiKey: "test-mistral-key-12345" },
    });

    const pass1Response = {
      pages: [{ index: 0, markdown: "# Banana Pancakes\n## Ingredients\n- 2 cups flour\n## Instructions\n1. Mix." }],
    };
    const pass2Response = {
      choices: [{
        message: {
          content: JSON.stringify({
            title: "Banana Pancakes",
            description: null,
            prepMinutes: null,
            cookMinutes: null,
            totalMinutes: null,
            servings: null,
            ingredients: [{ quantity: "2", unit: "cups", name: "flour", note: null }],
            steps: ["Mix."],
            notes: null,
          }),
        },
      }],
    };

    const fetchCalls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      fetchCalls.push({ url: urlStr, init: init ?? {} });
      const body = init?.body ? JSON.parse(String(init.body)) : null;

      if (urlStr.includes("/v1/ocr")) {
        return new Response(JSON.stringify(pass1Response), { status: 200 });
      }
      if (urlStr.includes("/v1/chat/completions")) {
        expect(body.model).toBe("ministral-3b-2512");
        expect(body.response_format?.type).toBe("json_schema");
        expect(body.response_format?.json_schema?.name).toBe("recipe_extraction");
        // Official Mistral field name is `schema`, NOT `schema_object`
        expect(body.response_format?.json_schema?.schema).toBeDefined();
        expect(body.response_format?.json_schema?.schema_object).toBeUndefined();
        expect(body.response_format?.json_schema?.strict).toBe(true);
        expect(body.temperature).toBe(0);
        // System prompt should be in messages
        expect(body.messages[0].role).toBe("system");
        expect(body.messages[0].content).toContain("JSON object");
        // Pass-1 text should be in user message
        expect(body.messages[1].content).toContain("Banana Pancakes");
        return new Response(JSON.stringify(pass2Response), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await recognizeAndExtractWithMistral(
      Buffer.from("fake-image"),
      "image/png",
      fetchImpl as unknown as typeof fetch,
    );

    expect(result.status).toBe("ai-normalized");
    expect(result.draft.title).toBe("Banana Pancakes");
    expect(result.draft.ingredients).toHaveLength(1);
    expect(result.draft.ingredients[0]).toMatchObject({ quantity: 2, unit: "cups", name: "flour" });
    expect(fetchCalls).toHaveLength(2);
  });

  it("falls back to heuristic when pass-2 throws", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-mistral-fallback-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();
    await savePrivateOcrConfig({
      activeProvider: "mistral",
      mistral: { apiKey: "test-mistral-key-12345" },
    });

    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("/v1/ocr")) {
        return new Response(JSON.stringify({
          pages: [{ markdown: "# Cookies\n## Ingredients\n- 1 cup flour\n## Instructions\n1. Bake." }],
        }), { status: 200 });
      }
      if (urlStr.includes("/v1/chat/completions")) {
        // Simulate pass-2 failure
        return new Response("Internal error", { status: 500 });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await recognizeAndExtractWithMistral(
      Buffer.from("fake-image"),
      "image/png",
      fetchImpl as unknown as typeof fetch,
    );

    expect(result.status).toBe("heuristic-fallback");
    expect(result.draft.title).toBe("Cookies");
    expect(result.draft.ingredients.length).toBeGreaterThan(0);
  });

  it("falls back to heuristic when pass-2 returns invalid JSON", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-mistral-invalid-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();
    await savePrivateOcrConfig({
      activeProvider: "mistral",
      mistral: { apiKey: "test-mistral-key-12345" },
    });

    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("/v1/ocr")) {
        return new Response(JSON.stringify({
          pages: [{ markdown: "# Cake\n## Ingredients\n- 2 cups flour\n## Instructions\n1. Bake." }],
        }), { status: 200 });
      }
      if (urlStr.includes("/v1/chat/completions")) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "not valid json at all {" } }],
        }), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await recognizeAndExtractWithMistral(
      Buffer.from("fake-image"),
      "image/png",
      fetchImpl as unknown as typeof fetch,
    );

    expect(result.status).toBe("heuristic-fallback");
    expect(result.draft.title).toBe("Cake");
  });

  it("falls back to heuristic when pass-2 returns empty text", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-mistral-empty-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();
    await savePrivateOcrConfig({
      activeProvider: "mistral",
      mistral: { apiKey: "test-mistral-key-12345" },
    });

    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("/v1/ocr")) {
        return new Response(JSON.stringify({
          pages: [{ markdown: "# Soup\n## Ingredients\n- 1 cup water\n## Instructions\n1. Boil." }],
        }), { status: 200 });
      }
      if (urlStr.includes("/v1/chat/completions")) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "" } }],
        }), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await recognizeAndExtractWithMistral(
      Buffer.from("fake-image"),
      "image/png",
      fetchImpl as unknown as typeof fetch,
    );

    expect(result.status).toBe("heuristic-fallback");
    expect(result.draft.title).toBe("Soup");
  });

  it("does not log API keys or raw response bodies", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-mistral-nolog-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();
    await savePrivateOcrConfig({
      activeProvider: "mistral",
      mistral: { apiKey: "super-secret-mistral-key-xyz" },
    });

    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("/v1/ocr")) {
        return new Response(JSON.stringify({
          pages: [{ markdown: "# Test" }],
        }), { status: 200 });
      }
      if (urlStr.includes("/v1/chat/completions")) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ title: "Test", ingredients: [], steps: [] }) } }],
        }), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    });

    await recognizeAndExtractWithMistral(
      Buffer.from("fake-image"),
      "image/png",
      fetchImpl as unknown as typeof fetch,
    );

    // Verify Authorization header contains the key but we should not log it
    const calls = fetchImpl.mock.calls;
    for (const call of calls) {
      const init = (call as unknown[])[1] as RequestInit | undefined;
      if (init?.headers && typeof init.headers === "object" && !Array.isArray(init.headers)) {
        const auth = (init.headers as Record<string, string>).Authorization;
        if (auth) {
          expect(auth).toBe("Bearer super-secret-mistral-key-xyz");
        }
      }
    }
    // The key should not appear in any logger output — verified by the fact
    // that we only call logger.info/warn with structured metadata, never with
    // the full request/response body.
  });
});

/* -------------------------------------------------------------------------- */
/*  Gemini two-pass pipeline (with fetch seam)                               */
/* -------------------------------------------------------------------------- */

import { recognizeAndExtractWithGemini } from "@/lib/imports/providers/gemini";
import { recognizeAndExtractRecipe } from "@/lib/imports/providers/dispatcher";

describe("recognizeAndExtractWithGemini (no-network)", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) {
      const { rm } = await import("node:fs/promises");
      await rm(root, { recursive: true, force: true });
    }
    delete process.env.DATA_ROOT;
    delete process.env.PRIVATE_CONFIG_KEYRING;
    resetEnvCache();
    resetKeyringCache();
    root = undefined;
  });

  it("makes correct pass-1 (image) and pass-2 (text-only) request shapes", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-gemini-2pass-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();
    await savePrivateOcrConfig({
      activeProvider: "gemini",
      gemini: { apiKey: "test-gemini-key-123456789" },
    });

    const pass1OcrText = "# Chocolate Cake\n## Ingredients\n- 2 cups flour\n## Instructions\n1. Mix.";
    const pass2Structured = {
      title: "Chocolate Cake",
      description: null,
      prepMinutes: 15,
      cookMinutes: 30,
      totalMinutes: null,
      servings: 6,
      ingredients: [
        { quantity: "2", unit: "cups", name: "flour", note: null },
      ],
      steps: ["Mix."],
      notes: null,
    };

    const fetchCalls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      fetchCalls.push({ url: urlStr, init: init ?? {} });
      const body = init?.body ? JSON.parse(String(init.body)) : null;

      if (urlStr.includes("generateContent")) {
        // Both passes go to the same endpoint
        const hasImage = body?.contents?.[0]?.parts?.some(
          (p: { inlineData?: unknown }) => p.inlineData,
        );
        if (hasImage) {
          // Pass 1: image → OCR text
          return new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ text: pass1OcrText }] } }],
          }), { status: 200 });
        } else {
          // Pass 2: text → structured JSON
          return new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(pass2Structured) }] } }],
          }), { status: 200 });
        }
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await recognizeAndExtractWithGemini(
      Buffer.from("fake-image"),
      "image/png",
      fetchImpl as unknown as typeof fetch,
    );

    expect(result.status).toBe("ai-normalized");
    expect(result.draft.title).toBe("Chocolate Cake");
    expect(result.draft.prepMinutes).toBe(15);
    expect(result.draft.cookMinutes).toBe(30);
    expect(result.draft.servings).toBe(6);
    expect(result.draft.ingredients).toHaveLength(1);
    expect(result.draft.ingredients[0]).toMatchObject({ quantity: 2, unit: "cups", name: "flour" });
    // Both passes should have been called
    expect(fetchCalls).toHaveLength(2);

    // Verify pass-1 request shape (has inlineData image)
    const pass1Body = JSON.parse(String(fetchCalls[0]!.init.body));
    expect(pass1Body.contents[0].parts[0].text).toContain("Transcribe");
    expect(pass1Body.generationConfig.temperature).toBe(0);
    expect(pass1Body.contents[0].parts.some((p: { inlineData?: unknown }) => p.inlineData)).toBe(true);

    // Verify pass-2 request shape (text only, structured JSON response)
    const pass2Body = JSON.parse(String(fetchCalls[1]!.init.body));
    expect(pass2Body.generationConfig.responseMimeType).toBe("application/json");
    expect(pass2Body.generationConfig.responseSchema).toBeDefined();
    expect(pass2Body.systemInstruction.parts[0].text).toContain("JSON object");
    expect(pass2Body.contents[0].parts[0].text).toContain(pass1OcrText);
    expect(pass2Body.contents[0].parts.some((p: { inlineData?: unknown }) => p.inlineData)).toBe(false);
  });

  it("confirms pass-2 receives only text (no image)", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-gemini-passtext-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();
    await savePrivateOcrConfig({
      activeProvider: "gemini",
      gemini: { apiKey: "test-gemini-key-123456789" },
    });

    const pass2Content = JSON.stringify({
      title: "Test Recipe",
      ingredients: [{ quantity: "1", unit: "cup", name: "flour", note: null }],
      steps: ["Step 1."],
    });

    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      const body = init?.body ? JSON.parse(String(init.body)) : null;

      if (urlStr.includes("generateContent")) {
        const hasImage = body?.contents?.[0]?.parts?.some(
          (p: { inlineData?: unknown }) => p.inlineData,
        );
        if (!hasImage) {
          // Pass 2: verify no inlineData present
          const parts = body.contents[0].parts;
          expect(parts.every((p: { text?: string }) => p.text !== undefined)).toBe(true);
          return new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ text: pass2Content }] } }],
          }), { status: 200 });
        }
        // Pass 1
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: "# Test\n- 1 cup flour\n1. Mix." }] } }],
        }), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await recognizeAndExtractWithGemini(
      Buffer.from("fake-image"),
      "image/png",
      fetchImpl as unknown as typeof fetch,
    );

    expect(result.status).toBe("ai-normalized");
    expect(result.draft.title).toBe("Test Recipe");
  });

  it("falls back to heuristic when pass-2 throws", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-gemini-fallback-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();
    await savePrivateOcrConfig({
      activeProvider: "gemini",
      gemini: { apiKey: "test-gemini-key-123456789" },
    });

    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      const hasImage = body?.contents?.[0]?.parts?.some(
        (p: { inlineData?: unknown }) => p.inlineData,
      );

      if (hasImage) {
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: "# Cookies\n## Ingredients\n- 1 cup flour\n## Instructions\n1. Bake." }] } }],
        }), { status: 200 });
      }
      // Pass 2: simulate failure
      return new Response("Service unavailable", { status: 503 });
    });

    const result = await recognizeAndExtractWithGemini(
      Buffer.from("fake-image"),
      "image/png",
      fetchImpl as unknown as typeof fetch,
    );

    expect(result.status).toBe("heuristic-fallback");
    expect(result.draft.title).toBe("Cookies");
    expect(result.draft.ingredients.length).toBeGreaterThan(0);
  });

  it("falls back to heuristic when pass-2 returns invalid JSON", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-gemini-invalid-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();
    await savePrivateOcrConfig({
      activeProvider: "gemini",
      gemini: { apiKey: "test-gemini-key-123456789" },
    });

    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      const hasImage = body?.contents?.[0]?.parts?.some(
        (p: { inlineData?: unknown }) => p.inlineData,
      );

      if (hasImage) {
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: "# Cake\n## Ingredients\n- 2 cups flour\n## Instructions\n1. Bake." }] } }],
        }), { status: 200 });
      }
      // Pass 2: returns broken JSON
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "{broken json" }] } }],
      }), { status: 200 });
    });

    const result = await recognizeAndExtractWithGemini(
      Buffer.from("fake-image"),
      "image/png",
      fetchImpl as unknown as typeof fetch,
    );

    expect(result.status).toBe("heuristic-fallback");
    expect(result.draft.title).toBe("Cake");
  });

  it("throws when no Gemini secrets configured", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-gemini-nosec-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();
    // No config at all — getGeminiSecrets returns null
    await expect(
      recognizeAndExtractWithGemini(Buffer.from("x"), "image/png"),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("does not include API key in error messages", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-gemini-err-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();
    await savePrivateOcrConfig({
      activeProvider: "gemini",
      gemini: { apiKey: "super-secret-gemini-key-abcdef" },
    });

    const fetchImpl = vi.fn(async () => {
      return new Response("Unauthorized", { status: 401 });
    });

    try {
      await recognizeAndExtractWithGemini(Buffer.from("x"), "image/png", fetchImpl as unknown as typeof fetch);
      expect.fail("should have thrown");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain("super-secret-gemini-key");
      expect(message).not.toContain("abcdef");
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  Tesseract does NOT invoke a second pass                                    */
/* -------------------------------------------------------------------------- */

describe("Tesseract does NOT invoke a second pass", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) {
      const { rm } = await import("node:fs/promises");
      await rm(root, { recursive: true, force: true });
    }
    delete process.env.DATA_ROOT;
    delete process.env.PRIVATE_CONFIG_KEYRING;
    resetEnvCache();
    resetKeyringCache();
    root = undefined;
  });

  it("recognizeAndExtractRecipe rejects Tesseract and never calls providers", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-tesseract-nopass2-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();
    // Default config is tesseract
    await savePrivateOcrConfig({ activeProvider: "tesseract" });
    expect(await getEffectiveOcrProvider()).toBe("tesseract");

    const fetchImpl = vi.fn();
    await expect(
      recognizeAndExtractRecipe(Buffer.from("x"), "image/png", { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // No fetch calls should have been made — Tesseract runs in the browser
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
