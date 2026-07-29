import { describe, expect, it } from "vitest";
import type { Account } from "@/types";
import { hasCapability, validateCapabilityAssignment } from "@/lib/authorization/capabilities";
import { canViewRecipe } from "@/lib/authorization/visibility";

function account(overrides: Partial<Account> = {}): Account {
  return {
    schemaVersion: 1,
    id: "00000000-0000-4000-8000-000000000001",
    username: "guest",
    displayName: "Guest",
    password: { algo: "scrypt", N: 16_384, r: 8, p: 1, salt: "salt", hash: "hash" },
    type: "guest",
    capabilities: ["recipes.read"],
    sessionVersion: 1,
    disabledAt: null,
    createdViaInvitationId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("capabilities", () => {
  it("enforces guest dependencies", () => {
    expect(validateCapabilityAssignment(["mealPlans.use"])).toContain("requires");
    expect(validateCapabilityAssignment(["recipes.read", "mealPlans.use"])).toBeNull();
    expect(validateCapabilityAssignment(["recipes.manage"])).toContain("owner-only");
  });

  it("treats owners as implicitly capable and disabled accounts as incapable", () => {
    expect(hasCapability(account({ type: "owner", capabilities: [] }), "recipes.manage")).toBe(true);
    expect(hasCapability(account({ disabledAt: "2026-01-02T00:00:00.000Z" }), "recipes.read")).toBe(false);
  });
});

describe("recipe visibility", () => {
  const config = { defaultVisibility: "members" as const };

  it("applies site defaults and per-recipe overrides", () => {
    expect(canViewRecipe({ visibility: "inherit" }, config, null)).toBe(false);
    expect(canViewRecipe({ visibility: "inherit" }, config, account())).toBe(true);
    expect(canViewRecipe({ visibility: "public" }, config, null)).toBe(true);
    expect(canViewRecipe({ visibility: "owner" }, config, account())).toBe(false);
    expect(canViewRecipe({ visibility: "owner" }, config, account({ type: "owner" }))).toBe(true);
  });
});
