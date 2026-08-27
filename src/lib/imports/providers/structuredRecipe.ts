/**
 * Provider-neutral structured recipe extraction schema and conversion.
 *
 * Second-pass contract (shared by Mistral and Gemini):
 * - Fixed prompt: treat source as a cookbook or recipe page and extract one
 *   primary recipe. Copy a description only from an actual intro, subtitle,
 *   or blurb — never invent a summary. Recognise labelled or abbreviated
 *   prep, cook, and total time and parse explicit numeric minute values.
 *   Keep quantity, unit, ingredient name, and trailing qualifier in their
 *   own fields; preserve fractions, ranges, and package wording as source
 *   text. The `note` field only receives qualifiers such as preparation
 *   methods, alternatives, parentheticals, and "to taste". Preserve
 *   ordered instructions and bottom-of-recipe notes, tips, and variations.
 *   Exclude page furniture: logos, watermark or template credit, page
 *   numbers, headers/footers, and unrelated text.
 * - Strict JSON Schema output, temperature 0 / deterministic.
 * - Provider-neutral output converted to canonical RecipeDraft.
 */

import type { RecipeDraft } from "@/types";
import { parseIngredientLine } from "@/lib/imports/textParsing";
import { recipeDraftSchema } from "@/lib/validation/schemas";

/* -------------------------------- types ---------------------------------- */

export interface StructuredIngredient {
  quantity: string | null;
  unit: string | null;
  name: string;
  note: string | null;
}

export interface StructuredRecipe {
  title: string | null;
  description: string | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  /** Intermediate field only — not persisted. Used for disambiguation. */
  totalMinutes: number | null;
  servings: number | null;
  ingredients: StructuredIngredient[];
  steps: string[];
  notes: string | null;
}

export interface ExtractionResult {
  draft: RecipeDraft;
  status: "ai-normalized" | "heuristic-fallback";
}

/* -------------------------------- prompt --------------------------------- */

const SYSTEM_PROMPT =
  "You are a recipe data extraction assistant. The source is a cookbook or recipe page. " +
  "Extract one primary recipe from the OCR text. " +
  "Return only the JSON object — no prose, no explanation, no markdown fences.";

export const EXTRACTION_USER_PROMPT_PREFIX = [
  "Extract recipe information from the following OCR text.",
  "",
  "Source context: treat the text as a cookbook or recipe page. Extract exactly one recipe.",
  "",
  "Field rules:",
  "- title: the recipe name as written.",
  "- description: copy only from an actual intro, subtitle, or blurb. Never invent or summarise.",
  "- prepMinutes / cookMinutes: parse explicit numeric minute values from labelled or abbreviated",
  '  time fields (e.g. "Prep Time: 10 min", "Cook: 25 minutes", "preparation 1 h 15 min").',
  "  Convert hours to minutes. If both prep and cook are present the UI computes total.",
  "- totalMinutes: if a labelled total-time value is present, report it here as an integer.",
  "  Do NOT fabricate a total. Do NOT use total as cook time.",
  "- servings / yields: extract a numeric servings or yield count when present.",
  "- ingredients: keep quantity, unit, name, and trailing qualifier in their own fields.",
  "  Preserve fractions (1/2, 1 3/4), ranges (2-3), and package wording as source text.",
  '  The note field is only for qualifiers: preparation method, alternatives, parentheticals,',
  '  or "to taste". Do not place part of the ingredient name into note.',
  "- steps: preserve the original ordered instructions exactly as written.",
  "- notes: capture bottom-of-recipe notes, tips, or variations. Combine into one string.",
  "",
  "Exclusion rules:",
  "- Exclude page furniture: logos, watermark or template credit, page numbers, headers/footers,",
  "  and unrelated surrounding text.",
  "- Do NOT extract nutrition tables or side-bar recipes.",
  "",
  "Strictness rules:",
  "- Use null or empty arrays for absent source fields.",
  "- No hallucination, substitution, unit conversion, or prose outside strict JSON.",
  "- Return no text outside the JSON object.",
  "",
  "OCR text:",
  "",
].join("\n");

export { SYSTEM_PROMPT };

/* ------------------------------- JSON schemas ---------------------------- */

/**
 * Mistral strict JSON Schema for pass-2 structured extraction.
 * Uses anyOf for nullable fields (OpenAI-compatible JSON Schema).
 * totalMinutes is included for disambiguation but is NOT persisted.
 */
export function mistralExtractionSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      title: { anyOf: [{ type: "string" }, { type: "null" }] },
      description: { anyOf: [{ type: "string" }, { type: "null" }] },
      prepMinutes: { anyOf: [{ type: "integer" }, { type: "null" }] },
      cookMinutes: { anyOf: [{ type: "integer" }, { type: "null" }] },
      totalMinutes: { anyOf: [{ type: "integer" }, { type: "null" }] },
      servings: { anyOf: [{ type: "integer" }, { type: "null" }] },
      ingredients: {
        type: "array",
        items: {
          type: "object",
          properties: {
            quantity: { anyOf: [{ type: "string" }, { type: "null" }] },
            unit: { anyOf: [{ type: "string" }, { type: "null" }] },
            name: { type: "string" },
            note: { anyOf: [{ type: "string" }, { type: "null" }] },
          },
          required: ["name"],
          additionalProperties: false,
        },
      },
      steps: {
        type: "array",
        items: { type: "string" },
      },
      notes: { anyOf: [{ type: "string" }, { type: "null" }] },
    },
    required: ["title", "ingredients", "steps"],
    additionalProperties: false,
  };
}

/**
 * Gemini responseSchema for pass-2 structured extraction.
 * Uses Gemini-specific type names (OBJECT, STRING, etc.) with nullable.
 * totalMinutes is included for disambiguation but is NOT persisted.
 */
export function geminiExtractionSchema(): Record<string, unknown> {
  return {
    type: "OBJECT",
    properties: {
      title: { type: "STRING", nullable: true },
      description: { type: "STRING", nullable: true },
      prepMinutes: { type: "INTEGER", nullable: true },
      cookMinutes: { type: "INTEGER", nullable: true },
      totalMinutes: { type: "INTEGER", nullable: true },
      servings: { type: "INTEGER", nullable: true },
      ingredients: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            quantity: { type: "STRING", nullable: true },
            unit: { type: "STRING", nullable: true },
            name: { type: "STRING" },
            note: { type: "STRING", nullable: true },
          },
          required: ["name"],
        },
      },
      steps: {
        type: "ARRAY",
        items: { type: "STRING" },
      },
      notes: { type: "STRING", nullable: true },
    },
    required: ["title", "ingredients", "steps"],
  };
}

/* --------------------------- conversion helpers --------------------------- */

function emptyDraft(): RecipeDraft {
  return {
    visibility: "inherit",
    title: "",
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
    stagedMedia: [],
  };
}

/**
 * Convert a single structured ingredient to a parsed ingredient line.
 * Uses the existing fraction-aware parser for quantity conversion.
 */
function convertIngredient(item: StructuredIngredient): RecipeDraft["ingredients"][number] | null {
  if (!item.name || !item.name.trim()) return null;
  // Reconstruct a parseable line so the fraction parser handles quantities
  const parts: string[] = [];
  if (item.quantity) parts.push(item.quantity);
  if (item.unit) parts.push(item.unit);
  parts.push(item.name);
  const reconstructed = parts.join(" ");

  const parsed = parseIngredientLine(reconstructed);
  if (parsed) {
    return {
      quantity: parsed.quantity,
      unit: item.unit ?? parsed.unit,
      name: item.name.slice(0, 200),
      note: (item.note ?? parsed.note)?.slice(0, 200) ?? null,
    };
  }

  // Fallback: use the raw structured data if the parser fails
  return {
    quantity: null,
    unit: item.unit?.slice(0, 30) ?? null,
    name: item.name.slice(0, 200),
    note: item.note?.slice(0, 200) ?? null,
  };
}

/* --------------------------------- export --------------------------------- */

/**
 * Convert a provider-neutral StructuredRecipe to a canonical RecipeDraft.
 * Parses textual quantities through the fraction-aware parser and validates
 * the result with recipeDraftSchema.
 *
 * Time logic:
 * - Use explicit prepMinutes and cookMinutes when present.
 * - If cookMinutes is absent but totalMinutes and prepMinutes are both present
 *   and totalMinutes > prepMinutes, derive cookMinutes = total - prep.
 * - Do NOT blindly map totalMinutes into cookMinutes when they could be
 *   the same value — that would be misleading.
 */
export function convertStructuredToDraft(data: StructuredRecipe): RecipeDraft {
  const draft = emptyDraft();

  draft.title = (data.title ?? "").slice(0, 200);
  draft.description = (data.description ?? "").slice(0, 2000);
  draft.prepMinutes =
    typeof data.prepMinutes === "number" && data.prepMinutes >= 0 ? Math.round(data.prepMinutes) : null;
  draft.cookMinutes =
    typeof data.cookMinutes === "number" && data.cookMinutes >= 0 ? Math.round(data.cookMinutes) : null;
  draft.servings = typeof data.servings === "number" && data.servings > 0 ? Math.round(data.servings) : null;

  // Total-time disambiguation: derive cook from total only when both are
  // known and the arithmetic is unambiguous.  Never map a lone total into
  // cook — the UI computes total from prep + cook.
  const total =
    typeof data.totalMinutes === "number" && data.totalMinutes >= 0
      ? Math.round(data.totalMinutes)
      : null;
  if (draft.cookMinutes === null && draft.prepMinutes !== null && total !== null && total > draft.prepMinutes) {
    draft.cookMinutes = total - draft.prepMinutes;
  }

  draft.ingredients = (data.ingredients ?? [])
    .map(convertIngredient)
    .filter((i): i is NonNullable<typeof i> => i !== null)
    .slice(0, 200);

  draft.steps = (data.steps ?? [])
    .map((s) => s.trim().slice(0, 2000))
    .filter((s) => s.length > 0)
    .slice(0, 100);

  draft.notesMarkdown = (data.notes ?? "").slice(0, 20_000);

  return draft;
}

/**
 * Attempt to normalize OCR text through the structured extraction pipeline.
 * Returns the extracted draft with status, or null if parsing/validation fails.
 * The caller should fall back to the heuristic parser when null is returned.
 */
export function tryStructuredExtraction(rawJson: string): RecipeDraft | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  const structured: StructuredRecipe = {
    title: typeof obj.title === "string" ? obj.title : null,
    description: typeof obj.description === "string" ? obj.description : null,
    prepMinutes: typeof obj.prepMinutes === "number" ? obj.prepMinutes : null,
    cookMinutes: typeof obj.cookMinutes === "number" ? obj.cookMinutes : null,
    totalMinutes: typeof obj.totalMinutes === "number" ? obj.totalMinutes : null,
    servings: typeof obj.servings === "number" ? obj.servings : null,
    ingredients: Array.isArray(obj.ingredients)
      ? obj.ingredients
          .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
          .map((item) => ({
            quantity: typeof item.quantity === "string" ? item.quantity : null,
            unit: typeof item.unit === "string" ? item.unit : null,
            name: typeof item.name === "string" ? item.name : "",
            note: typeof item.note === "string" ? item.note : null,
          }))
          .filter((item) => item.name.length > 0)
      : [],
    steps: Array.isArray(obj.steps)
      ? obj.steps.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      : [],
    notes: typeof obj.notes === "string" ? obj.notes : null,
  };

  const draft = convertStructuredToDraft(structured);

  // Validate against the canonical recipeDraftSchema
  const result = recipeDraftSchema.safeParse(draft);
  if (!result.success) return null;

  return result.data;
}
