import type { SiteConfig } from "@/types";
import { nowIso } from "@/lib/time";
import { siteConfigSchema } from "@/lib/validation/schemas";
import { SCHEMA_VERSIONS } from "@/lib/validation/constants";
import { readJson, writeJsonAtomic } from "../atomic";
import { resolveWithin } from "../paths";
import { quarantineFile } from "../quarantine";

const configPath = () => resolveWithin("config", "site.json");

export function defaultSiteConfig(): SiteConfig {
  const now = nowIso();
  return {
    schemaVersion: SCHEMA_VERSIONS.siteConfig,
    siteName: "Marcia Recipe",
    defaultVisibility: "public",
    theme: "editorial",
    setupCompletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Load site config, falling back to defaults when absent; quarantines malformed config. */
export async function getSiteConfig(): Promise<SiteConfig> {
  const config = await readJson(configPath(), siteConfigSchema, { quarantine: quarantineFile });
  return config ?? defaultSiteConfig();
}

export async function saveSiteConfig(config: SiteConfig): Promise<void> {
  await writeJsonAtomic(configPath(), siteConfigSchema.parse({ ...config, updatedAt: nowIso() }));
}
