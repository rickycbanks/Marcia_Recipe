import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { writeJsonAtomic } from "@/lib/storage/atomic";
import { ensureDataRoot, getDataRoot } from "@/lib/storage/dataRoot";
import { defaultSiteConfig, getSiteConfig } from "@/lib/storage/repositories/config";
import { THEMES } from "@/lib/validation/constants";
import { siteConfigSchema } from "@/lib/validation/schemas";

const NOW = "2026-01-01T00:00:00.000Z";

let root: string | undefined;

function validConfig(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1 as const,
    siteName: "Marcia Recipe",
    defaultVisibility: "members" as const,
    theme: "editorial" as const,
    setupCompletedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  delete process.env.DATA_ROOT;
  resetEnvCache();
  root = undefined;
});

describe("site settings defaults", () => {
  it("defaults visibility to members", () => {
    expect(defaultSiteConfig().defaultVisibility).toBe("members");
    expect(defaultSiteConfig().theme).toBe("editorial");
  });

  it("returns members from getSiteConfig when no config file exists", async () => {
    root = await mkdtemp(join(tmpdir(), "settings-default-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await ensureDataRoot();

    const config = await getSiteConfig();
    expect(config.defaultVisibility).toBe("members");
    expect(config.siteName).toBe("Marcia Recipe");
  });

  it("persists an existing public visibility without converting it", async () => {
    root = await mkdtemp(join(tmpdir(), "settings-public-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await ensureDataRoot();
    await writeJsonAtomic(join(getDataRoot(), "config", "site.json"), validConfig({ defaultVisibility: "public" }));

    const config = await getSiteConfig();
    expect(config.defaultVisibility).toBe("public");
  });
});

describe("site theme validation", () => {
  it("accepts the purple, turquoise, and dusty-rose themes", () => {
    for (const theme of ["purple", "turquoise", "dusty-rose"] as const) {
      expect(THEMES).toContain(theme);
      const parsed = siteConfigSchema.safeParse(validConfig({ theme }));
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.theme).toBe(theme);
    }
  });

  it("rejects an unknown theme", () => {
    const parsed = siteConfigSchema.safeParse(validConfig({ theme: "nonexistent" }));
    expect(parsed.success).toBe(false);
  });
});
