import type { RecipeDraft } from "@/types";
import { parseIngredientLine, sanitizeText } from "./textParsing";

/**
 * Heuristic parser for OCR-recognized recipe text (Tesseract.js runs in the
 * browser; only plain text reaches this code — OCR failures cannot affect the
 * server). Handles the classic layout: title, "Ingredients" section, then
 * "Instructions/Directions/Method" section.
 */

const INGREDIENTS_HEADER = /^\s*(ingredients|what you('|’)ll need|you will need)\s*:?\s*$/i;
const STEPS_HEADER = /^\s*(instructions?|directions?|method|preparation|steps|how to (make|prepare|cook))\s*:?\s*$/i;
const SECTION_NOISE = /^\s*(notes?|tips?|variations?|nutrition|servings?|prep(aration)? time|cook time|total time)\b/i;

export function parseRecipeText(rawText: string): RecipeDraft {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => sanitizeText(l))
    .filter((l) => l.length > 0);

  const draft: RecipeDraft = {
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
    ingredients: [],
    steps: [],
    notesMarkdown: "",
  };
  if (lines.length === 0) return draft;

  type Section = "preamble" | "ingredients" | "steps";
  let section: Section = "preamble";
  const ingredientLines: string[] = [];
  const stepLines: string[] = [];
  const preambleLines: string[] = [];

  for (const line of lines) {
    if (INGREDIENTS_HEADER.test(line)) {
      section = "ingredients";
      continue;
    }
    if (STEPS_HEADER.test(line)) {
      section = "steps";
      continue;
    }
    if (section !== "preamble" && SECTION_NOISE.test(line)) break;
    if (section === "ingredients") ingredientLines.push(line);
    else if (section === "steps") stepLines.push(line);
    else preambleLines.push(line);
  }

  // If no explicit sections were detected, guess: lines that parse with a
  // quantity are ingredients; the remaining tail becomes steps.
  if (ingredientLines.length === 0 && stepLines.length === 0) {
    const guessedIngredients: string[] = [];
    const guessedSteps: string[] = [];
    let seenQuantity = false;
    for (const line of lines.slice(1)) {
      const parsed = parseIngredientLine(line);
      if (parsed && parsed.quantity !== null) {
        guessedIngredients.push(line);
        seenQuantity = true;
      } else if (seenQuantity) {
        guessedSteps.push(line);
      }
    }
    ingredientLines.push(...guessedIngredients);
    stepLines.push(...guessedSteps);
  }

  draft.title = (preambleLines[0] ?? lines[0] ?? "").slice(0, 200);
  draft.description = preambleLines.slice(1).join(" ").slice(0, 2000);
  draft.ingredients = ingredientLines
    .map(parseIngredientLine)
    .filter((i): i is NonNullable<typeof i> => i !== null)
    .slice(0, 200);
  draft.steps = stepLines
    .map((l) => l.replace(/^\d+[.)]\s*/, "")) // strip leading step numbers
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, 100);
  return draft;
}
