import { describe, expect, it } from "vitest";
import { binarizePixel, grayscalePixel, upscaleFactor } from "@/lib/imports/preprocess";

describe("grayscalePixel", () => {
  it("returns the BT.709 luminance for a pixel", () => {
    // FP rounding: the result is written to a Uint8ClampedArray in practice.
    expect(grayscalePixel(255, 255, 255)).toBeCloseTo(255, 5);
    expect(grayscalePixel(0, 0, 0)).toBe(0);
    // 0.2126*100 + 0.7152*150 + 0.0722*200 ≈ 142.98
    expect(grayscalePixel(100, 150, 200)).toBeCloseTo(142.98, 1);
    // gray-in-gray-out
    expect(grayscalePixel(128, 128, 128)).toBeCloseTo(128, 5);
  });
});

describe("binarizePixel", () => {
  it("keeps pure white and pure black unchanged", () => {
    expect(binarizePixel(255, 255, 255)).toBe(255);
    expect(binarizePixel(0, 0, 0)).toBe(0);
  });

  it("applies the threshold boundary (>= threshold → white)", () => {
    expect(binarizePixel(140, 140, 140)).toBe(255);
    expect(binarizePixel(139, 139, 139)).toBe(0);
  });

  it("binarizes a colored pixel by BT.709 luminance", () => {
    // 0.2126*100 + 0.7152*150 + 0.0722*200 ≈ 143 > 140 → white
    expect(binarizePixel(100, 150, 200)).toBe(255);
    // luminance ≈ 46 < 140 → black
    expect(binarizePixel(50, 40, 60)).toBe(0);
  });
});

describe("upscaleFactor", () => {
  it("caps the upscale at 3x by default", () => {
    expect(upscaleFactor(500)).toBe(3);
  });

  it("scales proportionally toward the min width", () => {
    expect(upscaleFactor(750)).toBe(2);
  });

  it("returns 1 when already at or above the min width (never downscales)", () => {
    expect(upscaleFactor(1500)).toBe(1);
    expect(upscaleFactor(3000)).toBe(1);
  });

  it("honors a custom maxScale", () => {
    expect(upscaleFactor(1000, 1500, 5)).toBe(1.5);
  });
});
