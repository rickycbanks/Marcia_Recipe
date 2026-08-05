import type { RecipeDraft } from "@/types";
import { parseIngredientLine, parseMinutesFromText, parseServings, sanitizeText } from "./textParsing";

/**
 * Heuristic parser for OCR-recognized recipe text. Three paths:
 * 1. Markdown-structured output (Mistral OCR): a `#` title, ingredient list
 *    (bulleted or plain quantity-led lines), numbered steps (arabic or roman),
 *    metadata lines (times/servings), and VARIATION/notes blocks — detected
 *    and parsed first. LaTeX-escaped fractions ("\\(1 / 4\\)") are normalized.
 * 2. Tesseract two-column text: step markers interleaved with ingredient lines
 *    (read left-to-right across columns), with `l.`/fraction misreads handled.
 * 3. Classic raw text (Tesseract): explicit "Ingredients"/"Instructions"
 *    headers, or a quantity-based guess when no headers exist.
 * Returns a DRAFT only — nothing is persisted by this code.
 */

const INGREDIENTS_HEADER = /^\s*(ingredients|what you('|’)ll need|you will need)\s*:?\s*$/i;
const STEPS_HEADER = /^\s*(instructions?|directions?|method|preparation|steps|how to (make|prepare|cook))\s*:?\s*$/i;
const SECTION_NOISE = /^\s*(notes?|tips?|variations?|nutrition|servings?|prep(aration)? time|cook time|total time)\b/i;

const MARKDOWN_HEADING = /^#/;
const MARKDOWN_BULLET = /^[-*+]\s+/;
const MARKDOWN_NUMBERED = /^(?:\d+|[IVXLCDM]+)\.\s+/i;
const MARKDOWN_RULE = /^[-*+_]{3,}\s*$/;
const TIME_LABEL = /^(?:prep(?:aration)?|cook(?:ing)?|total)\b/i;
const SERVING_LABEL = /^(?:makes|serves|servings?|yield|yields?)\b/i;
const NOTES_MARKER = /^(?:variation|notes?|tips?)\s*:/i;
const BARE_TIME = /\d+\s*(?:hrs?|hours?|mins?|minutes?)\b/i;

/**
 * Convert LaTeX-escaped fractions ("\\(1 / 4\\)") to plain "1/4" so the
 * ingredient parser can read them as quantities. Mistral OCR emits fractions
 * this way; other text passes through unchanged.
 */
export function normalizeLatexFractions(text: string): string {
  return text.replace(/\\\(\s*(\d+)\s*\/\s*(\d+)\s*\\\)/g, "$1/$2");
}

/**
 * Conservative fixes for common Tesseract misreads of unicode fractions.
 * Only applied when the surrounding pattern is specific enough to avoid false
 * positives on real text.
 */
export function normalizeTesseractFractions(text: string): string {
  let out = text;
  // "1%" is a common misread of ½ (e.g. "1% cup" → "1/2 cup").
  out = out.replace(/(^|\s)1%(?=\s|$)/gi, "$11/2");
  // "Va" is a common misread of ¼ (e.g. "Va cup" → "1/4 cup").
  out = out.replace(/\bVa\b/gi, "1/4");
  // A bare "%" directly before "cup" is a misread of ¼.
  out = out.replace(/(^|\s)%(?=\s*cup\b)/gi, "$11/4");
  // "1 1 /2" — a spaced-out misread of ½; drop the spurious leading "1".
  out = out.replace(/(^|\s)1\s+1\s+\/\s*2(?=\s|$)/gi, "$11/2");
  // Normalize spacing around slashes in fraction-like patterns: "1/ 2" → "1/2".
  out = out.replace(/(\d+)\s*\/\s*(\d+)/g, "$1/$2");
  return out;
}

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

/** True when the text shows markdown structure (headings, bullets, numbered items). */
function isMarkdownStructured(lines: string[]): boolean {
  let headings = 0;
  let bullets = 0;
  let numbered = 0;
  for (const line of lines) {
    if (MARKDOWN_HEADING.test(line)) headings++;
    else if (MARKDOWN_BULLET.test(line)) bullets++;
    else if (MARKDOWN_NUMBERED.test(line)) numbered++;
  }
  // At least 2 bullets, or a heading combined with any list, is enough to trust
  // the markdown layout. A lone numbered line is left to the classic heuristics.
  if (bullets >= 2) return true;
  return headings >= 1 && (bullets >= 1 || numbered >= 1);
}

interface ParsedMetadataTime {
  prep: number | null;
  cook: number | null;
  total: number | null;
}

/** Parse a metadata line for time(s): labeled ("PREP 10 MIN · COOK 30 MIN") or bare ("1 HOUR"). */
function parseMetadataTime(line: string): ParsedMetadataTime {
  const result: ParsedMetadataTime = { prep: null, cook: null, total: null };
  if (!TIME_LABEL.test(line)) {
    // Bare duration ("1 HOUR") — most recipe cards show the cook time.
    result.cook = parseMinutesFromText(line);
    return result;
  }
  for (const segment of line.split(/[·,;|]+/)) {
    const text = segment.trim();
    let match = /^(?:prep(?:aration)?)\b[^:]*:?\s*(.+)$/i.exec(text);
    if (match?.[1]) {
      result.prep = parseMinutesFromText(match[1]);
      continue;
    }
    match = /^(?:cook(?:ing)?)\b[^:]*:?\s*(.+)$/i.exec(text);
    if (match?.[1]) {
      result.cook = parseMinutesFromText(match[1]);
      continue;
    }
    match = /^(?:total)\b[^:]*:?\s*(.+)$/i.exec(text);
    if (match?.[1]) {
      result.total = parseMinutesFromText(match[1]);
      continue;
    }
  }
  return result;
}

/** A non-list line that carries consumable metadata (times or servings) rather than content. */
function isMetadataLine(line: string): boolean {
  if (TIME_LABEL.test(line) && (/\d/.test(line) || /:/.test(line))) return true;
  if (SERVING_LABEL.test(line) && /\d/.test(line)) return true;
  if (BARE_TIME.test(line)) return true;
  return false;
}

/* ------------------------- Tesseract two-column text ------------------------ */

/** Step marker anywhere in a line: arabic, roman, or the "l." misread of "1.". */
const STEP_MARKER = /(?:\d+|[IVXLCDM]+|l)\.\s+/gi;

/** Bare-duration metadata anchored at line start ("1 HOUR" but not "1/4 cup ... 10 minutes"). */
const COLUMN_BARE_TIME = /^\d+\s*(?:hrs?|hours?|mins?|minutes?)\b/i;

/**
 * Metadata detection for two-column Tesseract text. Labels are anchored at the
 * start (same as the markdown path), but a bare duration only counts when it
 * opens the line — otherwise ingredient lines with a time in their trailing
 * note ("1/4 cup honey, simmer 10 minutes") would be wrongly consumed.
 */
function isColumnMetadataLine(line: string): boolean {
  if (TIME_LABEL.test(line) && (/\d/.test(line) || /:/.test(line))) return true;
  if (SERVING_LABEL.test(line) && /\d/.test(line)) return true;
  if (COLUMN_BARE_TIME.test(line)) return true;
  return false;
}

/** Mostly-punctuation OCR noise (binarization damage, page furniture, etc.). */
function isGarbageLine(line: string): boolean {
  let alphanumeric = 0;
  for (const ch of line) {
    if (/[a-zA-Z0-9]/.test(ch)) alphanumeric++;
  }
  return line.length > 0 && alphanumeric / line.length < 0.4;
}

/** Split a line at step markers: text before the first marker is the left column. */
function splitAtStepMarkers(line: string): { before: string; steps: string[] } {
  const matches: { index: number; length: number }[] = [];
  const regex = new RegExp(STEP_MARKER.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    matches.push({ index: match.index, length: match[0].length });
    if (match[0].length === 0) regex.lastIndex++;
  }
  if (matches.length === 0) return { before: line, steps: [] };

  const before = line.slice(0, matches[0]!.index).trim();
  const steps: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const start = m.index + m.length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index : line.length;
    const stepText = line.slice(start, end).trim();
    if (stepText) steps.push(stepText);
  }
  return { before, steps };
}

/**
 * Tesseract column-aware parser. Recipe pages are often read left-to-right
 * across two columns, interleaving an ingredient (left) and a numbered step
 * (right) on the same line; step markers may sit anywhere in a line and step 1
 * is frequently misread as "l." Runs only when at least one step marker exists
 * anywhere in the text. Returns null when nothing usable is found.
 */
function parseTesseractColumns(lines: string[]): RecipeDraft | null {
  const nonGarbage = lines.filter((line) => !isGarbageLine(line));
  if (!new RegExp(STEP_MARKER.source, "i").test(nonGarbage.join(" "))) return null;

  const draft = emptyDraft();
  const ingredients: RecipeDraft["ingredients"] = [];
  const steps: string[] = [];
  const notes: string[] = [];
  const titleCandidates: string[] = [];

  for (const line of nonGarbage) {
    if (NOTES_MARKER.test(line)) {
      notes.push(line);
      continue;
    }
    const { before, steps: lineSteps } = splitAtStepMarkers(line);
    if (lineSteps.length > 0) {
      for (const step of lineSteps) steps.push(step);
      if (before && !isColumnMetadataLine(before)) {
        const parsed = parseIngredientLine(before);
        if (parsed && parsed.quantity !== null) ingredients.push(parsed);
      }
      continue;
    }
    if (isColumnMetadataLine(line)) {
      const times = parseMetadataTime(line);
      if (times.prep !== null && draft.prepMinutes === null) draft.prepMinutes = times.prep;
      if (times.cook !== null && draft.cookMinutes === null) draft.cookMinutes = times.cook;
      if (times.total !== null && draft.cookMinutes === null) draft.cookMinutes = times.total;
      const serving = SERVING_LABEL.exec(line);
      if (serving && draft.servings === null) {
        draft.servings = parseServings(line.slice(serving[0].length));
      }
      continue;
    }
    const parsed = parseIngredientLine(line);
    if (parsed && parsed.quantity !== null) {
      ingredients.push(parsed);
      continue;
    }
    if (steps.length > 0) {
      // Continuation of the previous step (no marker, not an ingredient).
      const last = steps[steps.length - 1]!;
      steps[steps.length - 1] = `${last} ${line}`.trim();
    } else if (titleCandidates.length < 3) {
      titleCandidates.push(line);
    }
  }

  if (ingredients.length === 0 && steps.length === 0) return null;

  draft.title = (titleCandidates[0] ?? nonGarbage[0] ?? "").slice(0, 200);
  draft.ingredients = ingredients.slice(0, 200);
  draft.steps = steps
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 100);
  draft.notesMarkdown = notes.join("\n\n").slice(0, 20_000);
  return draft;
}

/**
 * Markdown-aware parser for Mistral OCR output: `#` title, ingredient list
 * (bullet OR plain quantity-led lines), numbered steps (arabic or roman),
 * metadata lines, and VARIATION/NOTES blocks. Metadata lines are consumed
 * (never become ingredients/steps). Fragmented note paragraphs are rejoined.
 * Falls back to the classic heuristic caller-side when this yields no
 * ingredients.
 */
function parseRecipeMarkdown(lines: string[]): RecipeDraft {
  const draft = emptyDraft();

  // Title: first `#` heading (strip the prefix); otherwise the first
  // content line that is not a list item or metadata.
  const heading = lines.find((line) => MARKDOWN_HEADING.test(line));
  let titleLine: string | null = null;
  if (heading) {
    titleLine = heading;
    draft.title = sanitizeText(heading.replace(/^#+\s*/, "")).slice(0, 200);
  } else {
    const fallback = lines.find(
      (line) => !MARKDOWN_BULLET.test(line) && !MARKDOWN_NUMBERED.test(line) && !isMetadataLine(line),
    );
    titleLine = fallback ?? lines[0] ?? null;
    draft.title = (titleLine ?? "").slice(0, 200);
  }

  const ingredientLines: string[] = [];
  const numbered: string[] = [];
  const preamble: string[] = [];
  const notesBlocks: string[][] = [];
  let noteBlock: string[] | null = null;
  let phase: "preamble" | "ingredients" | "steps" | "notes" = "preamble";

  for (const line of lines) {
    if (titleLine && line === titleLine) continue;
    if (MARKDOWN_RULE.test(line)) continue;
    if (MARKDOWN_HEADING.test(line)) {
      // Section heading: "Notes"/"Tips" start a notes block; other headings
      // move into the ingredients region.
      if (/^#+\s*(notes?|tips?)\b/i.test(line)) {
        phase = "notes";
        noteBlock = [];
        notesBlocks.push(noteBlock);
      } else {
        phase = "ingredients";
        noteBlock = null;
      }
      continue;
    }
    if (MARKDOWN_BULLET.test(line)) {
      phase = "ingredients";
      noteBlock = null;
      ingredientLines.push(line.replace(/^[-*+]\s+/, ""));
      continue;
    }
    if (MARKDOWN_NUMBERED.test(line)) {
      phase = "steps";
      noteBlock = null;
      numbered.push(line);
      continue;
    }
    if (NOTES_MARKER.test(line)) {
      phase = "notes";
      noteBlock = [];
      notesBlocks.push(noteBlock);
      noteBlock.push(line);
      continue;
    }
    if (isMetadataLine(line)) {
      const times = parseMetadataTime(line);
      if (times.prep !== null && draft.prepMinutes === null) draft.prepMinutes = times.prep;
      if (times.cook !== null && draft.cookMinutes === null) draft.cookMinutes = times.cook;
      if (times.total !== null && draft.cookMinutes === null) draft.cookMinutes = times.total;
      const serving = SERVING_LABEL.exec(line);
      if (serving && draft.servings === null) {
        draft.servings = parseServings(line.slice(serving[0].length));
      }
      continue;
    }
    if (phase === "preamble") {
      // A plain line that parses as an ingredient starts the ingredient block
      // (Mistral often omits bullet markers); otherwise it's description text.
      const parsed = parseIngredientLine(line);
      if (parsed && parsed.quantity !== null) {
        phase = "ingredients";
        ingredientLines.push(line);
      } else {
        preamble.push(line);
      }
      continue;
    }
    if (phase === "ingredients") {
      // Mistral may emit some ingredient lines without bullet markers; keep
      // any quantity-led line that the ingredient parser understands.
      const parsed = parseIngredientLine(line);
      if (parsed && parsed.quantity !== null) ingredientLines.push(line);
      continue;
    }
    if (phase === "notes" && noteBlock) {
      // Rejoin fragmented note paragraphs (Mistral splits long notes across
      // many lines) by accumulating the block and spacing at the end.
      noteBlock.push(line);
    }
    // phase === "steps": stray non-step text is ignored.
  }

  draft.description = preamble.join(" ").slice(0, 2000);
  draft.ingredients = ingredientLines
    .map(parseIngredientLine)
    .filter((ingredient): ingredient is NonNullable<typeof ingredient> => ingredient !== null)
    .slice(0, 200);
  draft.steps = numbered
    .map((step) => step.replace(MARKDOWN_NUMBERED, "").trim())
    .filter((step) => step.length > 0)
    .slice(0, 100);
  draft.notesMarkdown = notesBlocks
    .map((block) => block.join(" ").trim())
    .filter((block) => block.length > 0)
    .join("\n\n")
    .slice(0, 20_000);
  return draft;
}

/** Parse OCR text into a reviewable recipe draft (markdown-aware; never persists). */
export function parseRecipeText(rawText: string): RecipeDraft {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => normalizeLatexFractions(l))
    .map((l) => normalizeTesseractFractions(l))
    .map((l) => sanitizeText(l))
    .filter((l) => l.length > 0);

  if (lines.length === 0) return emptyDraft();

  // Mistral OCR emits markdown (headings, bullet or plain ingredient lines,
  // numbered steps). Prefer it when structure is detected — but only trust it
  // when it found ingredients; otherwise fall through to the other paths.
  if (isMarkdownStructured(lines)) {
    const markdownDraft = parseRecipeMarkdown(lines);
    if (markdownDraft.ingredients.length > 0) {
      return markdownDraft;
    }
  }

  // Tesseract reads two-column pages left-to-right, interleaving ingredients
  // and steps on the same line. Prefer the column-aware path when it found
  // usable content; otherwise fall through to the classic heuristics.
  const columnDraft = parseTesseractColumns(lines);
  if (columnDraft && (columnDraft.ingredients.length > 0 || columnDraft.steps.length > 0)) {
    return columnDraft;
  }

  const draft = emptyDraft();

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
