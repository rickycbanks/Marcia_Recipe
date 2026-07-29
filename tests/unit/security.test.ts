import { describe, expect, it } from "vitest";
import { assertFetchableUrl, isPublicIp } from "@/lib/imports/fetch";
import { safeEqual } from "@/lib/auth/tokens";
import { assertSafeSegment } from "@/lib/storage/paths";
import { assertSameOrigin } from "@/lib/authorization/origin";

describe("URL and path security", () => {
  it("accepts only standard HTTP(S) URLs without credentials", () => {
    expect(assertFetchableUrl("https://example.com/recipe").hostname).toBe("example.com");
    expect(() => assertFetchableUrl("file:///etc/passwd")).toThrow();
    expect(() => assertFetchableUrl("https://user:pass@example.com/recipe")).toThrow();
    expect(() => assertFetchableUrl("https://example.com:8443/recipe")).toThrow();
  });

  it("rejects private and reserved addresses", () => {
    expect(isPublicIp("1.1.1.1")).toBe(true);
    for (const ip of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1", "fc00::1"]) {
      expect(isPublicIp(ip)).toBe(false);
    }
  });

  it("rejects path separators and traversal segments", () => {
    expect(assertSafeSegment("valid-id")).toBe("valid-id");
    expect(() => assertSafeSegment("../secret")).toThrow();
    expect(() => assertSafeSegment("nested/value")).toThrow();
    expect(() => assertSafeSegment("\0")).toThrow();
  });

  it("compares secrets without accepting different lengths", () => {
    expect(safeEqual("same", "same")).toBe(true);
    expect(safeEqual("same", "different")).toBe(false);
  });

  it("requires an origin on cookie-authenticated mutations", () => {
    expect(() => assertSameOrigin(new Request("https://recipes.test/api/write", { method: "POST" }))).toThrow();
    expect(() =>
      assertSameOrigin(
        new Request("https://recipes.test/api/write", {
          method: "POST",
          headers: { host: "recipes.test", origin: "https://recipes.test" },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertSameOrigin(
        new Request("https://recipes.test/api/write", {
          method: "POST",
          headers: { host: "recipes.test", origin: "https://attacker.test" },
        }),
      ),
    ).toThrow();
  });
});
