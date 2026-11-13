import { describe, expect, it } from "vitest";
import { normalizeMeasure, resolveUnitId } from "@/lib/units";

describe("resolveUnitId", () => {
  it("resolves common spellings case-insensitively", () => {
    expect(resolveUnitId("tsp")).toBe("tsp");
    expect(resolveUnitId("TSP")).toBe("tsp");
    expect(resolveUnitId("teaspoons")).toBe("tsp");
    expect(resolveUnitId("Tbsp.")).toBe("tbsp");
    expect(resolveUnitId("tablespoon")).toBe("tbsp");
    expect(resolveUnitId("LBs")).toBe("lb");
    expect(resolveUnitId("pounds")).toBe("lb");
    expect(resolveUnitId("fl. oz.")).toBe("fl oz");
    expect(resolveUnitId("fluid ounce")).toBe("fl oz");
    expect(resolveUnitId("kilograms")).toBe("kg");
  });

  it("returns null for unknown and free-text units", () => {
    expect(resolveUnitId("pinch")).toBeNull();
    expect(resolveUnitId("clove")).toBeNull();
    expect(resolveUnitId("")).toBeNull();
    expect(resolveUnitId(null)).toBeNull();
    expect(resolveUnitId(undefined)).toBeNull();
  });
});

describe("normalizeMeasure", () => {
  it("converts 3 tsp to 1 tbsp", () => {
    expect(normalizeMeasure(3, "tsp")).toEqual({ quantity: 1, unit: "tbsp" });
    expect(normalizeMeasure(3, "teaspoons")).toEqual({ quantity: 1, unit: "tbsp" });
  });

  it("ladders US volume up to a cup but never beyond", () => {
    expect(normalizeMeasure(48, "tsp")).toEqual({ quantity: 1, unit: "cup" });
    expect(normalizeMeasure(16, "tbsp")).toEqual({ quantity: 1, unit: "cup" });
    expect(normalizeMeasure(768, "tsp")).toEqual({ quantity: 16, unit: "cups" });
    // user feedback: cup and everything larger stays as entered
    expect(normalizeMeasure(2, "cup")).toEqual({ quantity: 2, unit: "cups" });
    expect(normalizeMeasure(2, "pint")).toEqual({ quantity: 2, unit: "pints" });
    expect(normalizeMeasure(4, "quart")).toEqual({ quantity: 4, unit: "quarts" });
    expect(normalizeMeasure(2, "gallon")).toEqual({ quantity: 2, unit: "gallons" });
  });

  it("leaves values below 1 in the original unit", () => {
    expect(normalizeMeasure(2, "tsp")).toEqual({ quantity: 2, unit: "tsp" });
    expect(normalizeMeasure(1.5, "tsp")).toEqual({ quantity: 1.5, unit: "tsp" });
    expect(normalizeMeasure(0.5, "cup")).toEqual({ quantity: 0.5, unit: "cup" });
  });

  it("converts fractional steps for US volume when the smaller-unit count is >= 4", () => {
    expect(normalizeMeasure(4, "tbsp")).toEqual({ quantity: 0.25, unit: "cup" });
    expect(normalizeMeasure(8, "tbsp")).toEqual({ quantity: 0.5, unit: "cup" });
    expect(normalizeMeasure(12, "tsp")).toEqual({ quantity: 0.25, unit: "cup" });
    expect(normalizeMeasure(24, "tsp")).toEqual({ quantity: 0.5, unit: "cup" });
  });

  it("never converts US weight into fractional pounds", () => {
    expect(normalizeMeasure(4, "oz")).toEqual({ quantity: 4, unit: "oz" });
    expect(normalizeMeasure(16, "oz")).toEqual({ quantity: 1, unit: "lb" });
    expect(normalizeMeasure(24, "oz")).toEqual({ quantity: 1.5, unit: "lb" });
  });

  it("converts metric only on clean whole steps", () => {
    expect(normalizeMeasure(1000, "g")).toEqual({ quantity: 1, unit: "kg" });
    expect(normalizeMeasure(1500, "g")).toEqual({ quantity: 1.5, unit: "kg" });
    expect(normalizeMeasure(250, "g")).toEqual({ quantity: 250, unit: "g" });
    expect(normalizeMeasure(1000, "ml")).toEqual({ quantity: 1, unit: "l" });
    expect(normalizeMeasure(250, "ml")).toEqual({ quantity: 250, unit: "ml" });
  });

  it("leaves fl oz and unknown units untouched", () => {
    expect(normalizeMeasure(8, "fl oz")).toEqual({ quantity: 8, unit: "fl oz" });
    expect(normalizeMeasure(5, "pinch")).toEqual({ quantity: 5, unit: "pinch" });
  });

  it("applies the batch multiplier before converting", () => {
    // 1.5 tsp at x2 = 3 tsp -> 1 tbsp
    expect(normalizeMeasure(1.5, "tsp", 2)).toEqual({ quantity: 1, unit: "tbsp" });
    // 2 tbsp at x2 = 4 tbsp -> 1/4 cup
    expect(normalizeMeasure(2, "tbsp", 2)).toEqual({ quantity: 0.25, unit: "cup" });
    // 8 oz at x2 = 16 oz -> 1 lb
    expect(normalizeMeasure(8, "oz", 2)).toEqual({ quantity: 1, unit: "lb" });
  });

  it("passes through a half batch without inventing units", () => {
    expect(normalizeMeasure(1, "tbsp", 0.5)).toEqual({ quantity: 0.5, unit: "tbsp" });
    expect(normalizeMeasure(2, "cup", 0.5)).toEqual({ quantity: 1, unit: "cup" });
    expect(normalizeMeasure(1, "cup", 0.5)).toEqual({ quantity: 0.5, unit: "cup" });
  });

  it("handles a null unit by scaling only the quantity", () => {
    expect(normalizeMeasure(2, null, 2)).toEqual({ quantity: 4, unit: "" });
  });

  it("pluralizes labels only when the quantity exceeds one", () => {
    expect(normalizeMeasure(3, "quart")).toEqual({ quantity: 3, unit: "quarts" });
    expect(normalizeMeasure(0.5, "cup")).toEqual({ quantity: 0.5, unit: "cup" });
    expect(normalizeMeasure(2, "pint")).toEqual({ quantity: 2, unit: "pints" });
    expect(normalizeMeasure(2, "gallon")).toEqual({ quantity: 2, unit: "gallons" });
  });
});
