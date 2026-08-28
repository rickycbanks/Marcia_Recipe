/**
 * Shared fraction parsing and formatting utilities.
 *
 * - **Parsing**: accepts ASCII fractions (`1/2`), mixed fractions (`1 1/2`),
 *   whitespace around the slash, and Unicode fraction characters (e.g. `½`).
 *   Returns `null` for empty or unrecognised input.
 *
 * - **Formatting**: converts a stored decimal quantity to a human-friendly
 *   fraction string using a generative catalogue covering reduced denominators
 *   1–16 with a tight matching tolerance of ±0.001. Non-matches are displayed
 *   as a clean decimal.
 *
 * Immutability note: the module exports pure functions and a frozen catalogue
 * constant; no mutable shared state.
 */

// ── Unicode fraction catalogue ────────────────────────────────────────────────

/** Single-character Unicode fractions → decimal value. */
const UNICODE_FRACTIONS: Record<string, number> = {
  "\u00BC": 0.25, // ¼
  "\u00BD": 0.5, // ½
  "\u00BE": 0.75, // ¾
  "\u2150": 1 / 7, // ⅐
  "\u2151": 1 / 9, // ⅑
  "\u2152": 0.1, // ⅒
  "\u2153": 1 / 3, // ⅓
  "\u2154": 2 / 3, // ⅔
  "\u2155": 0.2, // ⅕
  "\u2156": 0.4, // ⅖
  "\u2157": 0.6, // ⅗
  "\u2158": 0.8, // ⅘
  "\u2159": 1 / 6, // ⅙
  "\u215A": 5 / 6, // ⅚
  "\u215B": 0.125, // ⅛
  "\u215C": 0.375, // ⅜
  "\u215D": 0.625, // ⅝
  "\u215E": 0.875, // ⅞
};

/** Greatest common divisor (Euclidean algorithm). */
function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

const FRACTION_TOLERANCE = 0.001;
const MAX_DENOMINATOR = 16;

// ── Formatting ───────────────────────────────────────────────────────────────

/**
 * Format a decimal quantity as a human-friendly fraction string.
 *
 * Examples:
 *   0.5   → "1/2"
 *   1.5   → "1 1/2"
 *   2     → "2"
 *   0.4   → "2/5"
 *   0.123 → "0.123"
 *   0     → "0"
 */
export function formatQuantity(quantity: number): string {
  if (!Number.isFinite(quantity)) return String(quantity);

  const sign = quantity < 0 ? "-" : "";
  const abs = Math.abs(quantity);

  // Whole number — nothing to fraction-ify.
  const whole = Math.floor(abs);
  const frac = abs - whole;

  // Floating-point residue near 0 or 1 → snap to the nearest whole.
  if (frac < FRACTION_TOLERANCE) {
    return sign + String(whole || "0");
  }
  if (1 - frac < FRACTION_TOLERANCE) {
    return sign + String(whole + 1);
  }

  // Search the generative catalogue for the best reduced fraction match.
  let bestN = 0;
  let bestD = 1;
  let bestErr = FRACTION_TOLERANCE;

  for (let d = 2; d <= MAX_DENOMINATOR; d++) {
    const n = Math.round(frac * d);
    if (n <= 0 || n >= d) continue;
    if (gcd(n, d) !== 1) continue; // only reduced fractions
    const err = Math.abs(frac - n / d);
    if (err < bestErr) {
      bestN = n;
      bestD = d;
      bestErr = err;
    }
  }

  if (bestN > 0) {
    const fracPart = `${bestN}/${bestD}`;
    return sign + (whole > 0 ? `${whole} ${fracPart}` : fracPart);
  }

  // No fraction within tolerance — display as a clean decimal.
  // Use toFixed(10) then strip trailing zeros (avoids 0.3000…0).
  const decimal = abs
    .toFixed(10)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
  return sign + (whole > 0 ? `${whole}.${decimal.split(".")[1] ?? ""}` : decimal);
}

// ── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Parse a user-entered quantity string into a decimal number.
 *
 * Accepted formats:
 *   "2"        → 2
 *   "1.5"      → 1.5
 *   "1/2"      → 0.5
 *   "1 1/2"    → 1.5   (mixed fraction)
 *   "1 / 2"    → 0.5   (whitespace around slash)
 *   "½"        → 0.5   (Unicode)
 *   "1½"       → 1.5   (integer + Unicode)
 *   "1 ½"      → 1.5
 *
 * Returns `null` for empty, blank, or unrecognised input.
 */
export function parseQuantityInput(input: string): number | null {
  const text = input.trim();
  if (!text) return null;

  // ── 1. ASCII fraction or mixed fraction ──────────────────────────────────
  //    Patterns: "1/2", "1 1/2", "1 / 2", "2 3 / 4"
  const fractionMatch = /^(\d+)?\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(text);
  if (fractionMatch) {
    const whole = Number(fractionMatch[1] ?? 0);
    const num = Number(fractionMatch[2]);
    const den = Number(fractionMatch[3]);
    if (Number.isFinite(den) && den !== 0) {
      return snapQuantity(whole + num / den);
    }
  }

  // ── 2. Plain decimal / integer ───────────────────────────────────────────
  //    Accepts comma as decimal separator (European style).
  const numberMatch = /^(\d+(?:[.,]\d+)?)\s*$/.exec(text);
  if (numberMatch) {
    const value = parseFloat(numberMatch[1]!.replace(",", "."));
    return Number.isFinite(value) ? value : null;
  }

  // ── 3. Unicode fraction (optionally preceded by an integer) ──────────────
  //    "½", "1½", "1 ½", "2 ¾"
  const unicodeMatch = /^(\d+)?\s*([\u00BC-\u00BE\u2150-\u215E])\s*$/.exec(text);
  if (unicodeMatch) {
    const whole = Number(unicodeMatch[1] ?? 0);
    const fracValue = UNICODE_FRACTIONS[unicodeMatch[2]!];
    if (fracValue !== undefined) {
      return snapQuantity(whole + fracValue);
    }
  }

  return null;
}

/**
 * Round a computed fraction result to 3 decimal places to avoid
 * IEEE-754 residue like `0.30000000000000004`.
 */
function snapQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}
