/**
 * Shared text-parsing heuristics used by URL imports AND OCR parsing.
 * Pure functions — deterministic and unit tested.
 */

const UNICODE_FRACTIONS: Record<string, number> = {
  "¼": 0.25, "½": 0.5, "¾": 0.75,
  "⅐": 1 / 7, "⅑": 1 / 9, "⅒": 0.1,
  "⅓": 1 / 3, "⅔": 2 / 3,
  "⅕": 0.2, "⅖": 0.4, "⅗": 0.6, "⅘": 0.8,
  "⅙": 1 / 6, "⅚": 5 / 6,
  "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
};

const KNOWN_UNITS = new Set([
  "g", "gram", "grams", "kg", "kilogram", "kilograms",
  "ml", "milliliter", "milliliters", "millilitre", "millilitres",
  "l", "liter", "liters", "litre", "litres",
  "tbsp", "tablespoon", "tablespoons", "tsp", "teaspoon", "teaspoons",
  "cup", "cups", "oz", "ounce", "ounces", "lb", "lbs", "pound", "pounds",
  "pinch", "pinches", "clove", "cloves", "can", "cans", "package", "packages", "pkg",
  "bunch", "bunches", "slice", "slices", "piece", "pieces", "stick", "sticks",
  "dash", "dashes", "head", "heads", "sprig", "sprigs",
]);

export interface ParsedIngredientLine {
  quantity: number | null;
  unit: string | null;
  name: string;
  note: string | null;
}

/** Collapse whitespace and strip control characters from extracted text. */
export function sanitizeText(value: string): string {
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim();
}

/** Parse a leading quantity: "2", "1.5", "1/2", "1 1/2", "½", "2½". */
function parseLeadingQuantity(text: string): { quantity: number | null; rest: string } {
  let rest = text.trimStart();
  let quantity = 0;
  let found = false;

  // Pure or mixed fraction first: "1/4", "1 1/2", "3 1/4 cups".
  const fractionMatch = /^(\d+)?\s*(\d+)\s*\/\s*(\d+)/.exec(rest);
  if (fractionMatch) {
    const denominator = Number(fractionMatch[3]!);
    if (Number.isFinite(denominator) && denominator !== 0) {
      quantity += Number(fractionMatch[1] ?? 0) + Number(fractionMatch[2]!) / denominator;
      rest = rest.slice(fractionMatch[0]!.length);
      found = true;
    }
  }
  if (!found) {
    const numberMatch = /^(\d+(?:[.,]\d+)?)/.exec(rest);
    if (numberMatch) {
      quantity = parseFloat(numberMatch[1]!.replace(",", "."));
      rest = rest.slice(numberMatch[0]!.length);
      found = true;
    }
  }
  // Unicode fraction, either alone ("½ cup") or trailing an integer ("1 ½ cups").
  const first = rest.trimStart().charAt(0);
  if (first && first in UNICODE_FRACTIONS) {
    quantity += UNICODE_FRACTIONS[first]!;
    rest = rest.trimStart().slice(1);
    found = true;
  }
  return { quantity: found ? Math.round(quantity * 1000) / 1000 : null, rest: rest.trim() };
}

/** Parse "2 cups flour, sifted" into quantity/unit/name/note. */
export function parseIngredientLine(rawLine: string): ParsedIngredientLine | null {
  const line = sanitizeText(rawLine).replace(/^[-*•·‣◦]\s*/, "");
  if (!line || line.length < 2) return null;

  const { quantity, rest } = parseLeadingQuantity(line);

  let unit: string | null = null;
  let remainder = rest;
  const words = rest.split(/\s+/);
  const firstWord = (words[0] ?? "").toLowerCase().replace(/\.$/, "");
  if (quantity !== null && KNOWN_UNITS.has(firstWord)) {
    unit = words[0]!.replace(/\.$/, "");
    remainder = words.slice(1).join(" ");
  }

  // Trailing ", note" or "(note)" becomes the note field.
  let note: string | null = null;
  const parenMatch = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(remainder);
  if (parenMatch && parenMatch[1]) {
    remainder = parenMatch[1].trim();
    note = parenMatch[2]?.trim() || null;
  } else {
    const commaIndex = remainder.indexOf(",");
    if (commaIndex > 0) {
      note = remainder.slice(commaIndex + 1).trim() || null;
      remainder = remainder.slice(0, commaIndex).trim();
    }
  }

  const name = remainder.trim();
  if (!name) return null;
  return { quantity, unit, name: name.slice(0, 200), note: note ? note.slice(0, 200) : null };
}

/** ISO-8601 duration ("PT1H30M", "P1DT2H") → whole minutes. */
export function parseIsoDuration(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value.trim());
  if (!match) return null;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  const total = days * 24 * 60 + hours * 60 + minutes + Math.round(seconds / 60);
  return total > 0 ? total : null;
}

/**
 * Human-readable duration text ("10 minutes", "1 hour 30 minutes",
 * "1 hr 15 min", "2 hours") → whole minutes. Null when nothing matches.
 */
export function parseMinutesFromText(text: string): number | null {
  let total = 0;
  let found = false;
  const hourMatch = /(\d+)\s*(?:hrs?|hours?)\b/i.exec(text);
  if (hourMatch && hourMatch[1] !== undefined) {
    total += Number(hourMatch[1]) * 60;
    found = true;
  }
  const minuteMatch = /(\d+)\s*(?:mins?|minutes?)\b/i.exec(text);
  if (minuteMatch && minuteMatch[1] !== undefined) {
    total += Number(minuteMatch[1]);
    found = true;
  }
  return found ? total : null;
}

/** recipeYield can be a string, number, or array — extract a servings count. */
export function parseServings(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw === "number" && raw > 0) return Math.round(raw);
  if (typeof raw === "string") {
    const match = /(\d+(?:\.\d+)?)/.exec(raw);
    if (match && match[1] !== undefined) {
      const n = parseFloat(match[1]);
      if (n > 0) return Math.round(n);
    }
  }
  return null;
}
