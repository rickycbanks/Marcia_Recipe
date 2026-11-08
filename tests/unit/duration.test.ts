import { describe, expect, it } from "vitest";
import {
  combineHoursMinutes,
  formatMinutesDuration,
  splitToHoursMinutes,
} from "@/lib/duration";

describe("formatMinutesDuration", () => {
  it("renders plain minutes under an hour", () => {
    expect(formatMinutesDuration(45)).toBe("45 minutes");
    expect(formatMinutesDuration(1)).toBe("1 minute");
  });

  it("renders whole hours without a minutes part", () => {
    expect(formatMinutesDuration(60)).toBe("1 hour");
    expect(formatMinutesDuration(120)).toBe("2 hours");
  });

  it("renders hours plus minutes", () => {
    expect(formatMinutesDuration(90)).toBe("1 hour 30 minutes");
    expect(formatMinutesDuration(150)).toBe("2 hours 30 minutes");
  });

  it("handles zero", () => {
    expect(formatMinutesDuration(0)).toBe("0 minutes");
  });
});

describe("combineHoursMinutes", () => {
  it("returns null when both halves are blank", () => {
    expect(combineHoursMinutes("", "  ")).toBeNull();
  });

  it("sums hours and minutes", () => {
    expect(combineHoursMinutes("1", "30")).toBe(90);
  });

  it("treats a blank half as zero", () => {
    expect(combineHoursMinutes("2", "")).toBe(120);
    expect(combineHoursMinutes("", "45")).toBe(45);
  });

  it("round-trips splitToHoursMinutes", () => {
    const split = splitToHoursMinutes(90);
    expect(combineHoursMinutes(split.hours, split.minutes)).toBe(90);
  });
});

describe("splitToHoursMinutes", () => {
  it("splits stored minutes into blank-if-zero halves", () => {
    expect(splitToHoursMinutes(90)).toEqual({ hours: "1", minutes: "30" });
    expect(splitToHoursMinutes(45)).toEqual({ hours: "", minutes: "45" });
    expect(splitToHoursMinutes(120)).toEqual({ hours: "2", minutes: "" });
    expect(splitToHoursMinutes(null)).toEqual({ hours: "", minutes: "" });
    expect(splitToHoursMinutes(0)).toEqual({ hours: "", minutes: "" });
  });
});
