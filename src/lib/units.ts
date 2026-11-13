/**
 * Common kitchen unit conversions for ingredient display.
 *
 * Storage is never rewritten — ingredients keep whatever unit they were
 * entered with (including free-text units like "clove" or "pinch"). This
 * module only normalizes (quantity, unit) pairs *for display*:
 *
 *   - The unit is resolved through a multi-spelling alias table
 *     (tsp / teaspoon / teaspoons / tbs / tbsp / "Tbsp." … all resolve).
 *   - Conversions happen within a dimension family only
 *     (volume-US, weight-US, weight-metric, volume-metric). Volume and
 *     weight are never crossed — that would need ingredient densities.
 *   - Quantities convert upward to a larger unit while the result stays
 *     "clean"≥ 1 expressed as a whole number or a common fraction with
 *     denominator ≤ 8), e.g. 3 tsp → 1 tbsp, 16 oz → 1 lb, 1000 g → 1 kg.
 *   - US-volume also converts when ≥ 4 of the smaller unit equals a clean
 *     fraction of the next larger unit (4 tbsp → 1/4 cup, 12 tsp → 1/4 cup,
 *     8 tbsp → 1/2 cup) — the idiomatic kitchen convention. The US-volume
 *     ladder stops at cup (user feedback): pint, quart and gallon stay as
 *     entered and never auto-convert upward.
 *
 * Immutability note: pure functions and frozen tables only.
 */

import { scaleQuantity } from "@/lib/fractions";

/* --------------------------------- families -------------------------------- */

type UnitId =
  | "tsp" | "tbsp" | "cup" | "pint" | "quart" | "gallon"
  | "oz" | "lb"
  | "g" | "kg"
  | "ml" | "l"
  | "fl oz";

interface Family {
  /** Ascending rungs: [id, size in base units]. */
  rungs: readonly (readonly [UnitId, number])[];
  /** Allow the ≥4-of-smaller-unit → clean-fraction conversion branch. */
  allowFractionalStepUp: boolean;
}

/**
 * US volume — base unit teaspoon. The ladder stops at cup: pint, quart and
 * gallon remain valid units but map to one-rung families below so they are
 * never rewritten (user feedback — no automatic cup → pint → … conversions).
 * fl oz is likewise not a rung. True ratios kept for reference:
 * 2 cup = 1 pint, 2 pint = 1 quart, 4 quart = 1 gallon.
 */
const VOLUME_US: Family = {
  rungs: [
    ["tsp", 1],
    ["tbsp", 3],
    ["cup", 48],
  ] as const,
  allowFractionalStepUp: true,
};

/** US weight — base unit ounce. Rigid: no 4 oz → 1/4 lb rewriting. */
const WEIGHT_US: Family = {
  rungs: [
    ["oz", 1],
    ["lb", 16],
  ] as const,
  allowFractionalStepUp: false,
};

/** Metric weight — base unit gram. */
const WEIGHT_METRIC: Family = {
  rungs: [
    ["g", 1],
    ["kg", 1000],
  ] as const,
  allowFractionalStepUp: false,
};

/** Metric volume — base unit milliliter. */
const VOLUME_METRIC: Family = {
  rungs: [
    ["ml", 1],
    ["l", 1000],
  ] as const,
  allowFractionalStepUp: false,
};

/**
 * Unit → family lookup. fl oz and the above-cup US volumes (pint, quart,
 * gallon) each map to a one-rung family so they are never rewritten.
 */
const FAMILY_BY_UNIT = new Map<UnitId, Family>([
  ...VOLUME_US.rungs.map(([id]) => [id, VOLUME_US] as const),
  ...WEIGHT_US.rungs.map(([id]) => [id, WEIGHT_US] as const),
  ...WEIGHT_METRIC.rungs.map(([id]) => [id, WEIGHT_METRIC] as const),
  ...VOLUME_METRIC.rungs.map(([id]) => [id, VOLUME_METRIC] as const),
  ...(["fl oz", "pint", "quart", "gallon"] as const).map(
    (id) => [id, { rungs: [[id, 1]], allowFractionalStepUp: false }] as const,
  ),
]);

/* --------------------------------- aliases --------------------------------- */

/**
 * Spellings that resolve to each canonical unit. Lookup is lowercase with
 * dots and extra spaces stripped. Single-letter "T"/"t" abbreviations are
 * deliberately excluded — they are ambiguous between tablespoon and
 * teaspoon once casing is ignored.
 */
const UNIT_ALIASES: Record<string, UnitId> = {
  // volume (US)
  tsp: "tsp", tsps: "tsp", teaspoon: "tsp", teaspoons: "tsp",
  tbsp: "tbsp", tbsps: "tbsp", tbs: "tbsp", tbl: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
  floz: "fl oz", "fl oz": "fl oz", "fluidounce": "fl oz", "fluidounces": "fl oz", ouncefluid: "fl oz",
  cup: "cup", cups: "cup", c: "cup",
  pint: "pint", pints: "pint", pt: "pint",
  quart: "quart", quarts: "quart", qt: "quart", qts: "quart",
  gallon: "gallon", gallons: "gallon", gal: "gallon",
  // weight (US)
  oz: "oz", ounce: "oz", ounces: "oz",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  // weight (metric)
  g: "g", gram: "g", grams: "g", gramme: "g", grammes: "g",
  kg: "kg", kgs: "kg", kilogram: "kg", kilograms: "kg", kilo: "kg", kilos: "kg",
  // volume (metric)
  ml: "ml", mls: "ml", milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml", cc: "ml",
  l: "l", liter: "l", liters: "l", litre: "l", litres: "l",
};

/** Plural forms for labels that change with quantity (others are invariant). */
const PLURAL_LABELS: Partial<Record<UnitId, string>> = {
  cup: "cups",
  pint: "pints",
  quart: "quarts",
  gallon: "gallons",
};

const SNAP_FACTOR = 1_000_000;

function snap(value: number): number {
  return Math.round(value * SNAP_FACTOR) / SNAP_FACTOR;
}

/** Resolve a free-text unit string to a canonical unit id, or null. */
export function resolveUnitId(unit: string | null | undefined): UnitId | null {
  if (!unit) return null;
  const key = unit.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
  if (!key) return null;
  return UNIT_ALIASES[key] ?? UNIT_ALIASES[key.replace(/\s/g, "")] ?? null;
}

/** Canonical display label, pluralized when the quantity calls for it. */
export function unitLabel(id: UnitId, quantity: number): string {
  const plural = PLURAL_LABELS[id];
  if (plural && quantity > 1) return plural;
  return id;
}

/**
 * True when value expresses exactly as a whole number or a common fraction
 * with denominator ≤ 8 (after snapping away binary-float residue).
 */
function isClean(value: number): boolean {
  const snapped = snap(value);
  if (Number.isInteger(snapped)) return true;
  for (let d = 2; d <= 8; d++) {
    const scaled = snapped * d;
    if (Math.abs(scaled - Math.round(scaled)) < 1 / (SNAP_FACTOR / 100)) return true;
  }
  return false;
}

export interface NormalizedMeasure {
  quantity: number;
  unit: string;
}

/**
 * Scale an ingredient quantity by a batch multiplier (default 1) and
 * normalize it to the friendliest kitchen unit for display.
 *
 * Unknown or free-text units pass through untouched (only the quantity is
 * scaled). A null unit also passes through with just the scaled quantity.
 */
export function normalizeMeasure(
  quantity: number,
  unit: string | null | undefined,
  multiplier = 1,
): NormalizedMeasure {
  const scaled = snap(scaleQuantity(quantity, multiplier));
  const id = resolveUnitId(unit);
  if (!id) {
    return { quantity: scaled, unit: (unit ?? "").trim() || "" };
  }

  const family = FAMILY_BY_UNIT.get(id)!;
  const index = family.rungs.findIndex(([rungId]) => rungId === id);
  if (index === -1) {
    return { quantity: scaled, unit: unitLabel(id, scaled) };
  }

  let currentId = id;
  let currentBase = family.rungs[index]![1];
  let value = scaled;

  // Walk upward one rung at a time while the conversion stays idiomatic.
  for (let i = index + 1; i < family.rungs.length; i++) {
    const [nextId, nextBase] = family.rungs[i]!;
    const candidate = snap((value * currentBase) / nextBase);

    const wholeStep = candidate >= 1 && isClean(candidate);
    const fractionalStep =
      family.allowFractionalStepUp && value >= 4 && candidate >= 0.25 && isClean(candidate);
    if (!wholeStep && !fractionalStep) break;

    value = candidate;
    currentId = nextId;
    currentBase = nextBase;
  }

  return { quantity: value, unit: unitLabel(currentId, value) };
}
