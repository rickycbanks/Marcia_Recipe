#!/usr/bin/env tsx
/**
 * Schema migration command. A backup is REQUIRED first (created automatically
 * unless --skip-backup is passed explicitly). Migrations are version-aware and
 * repeatable; unsupported future versions are rejected untouched.
 * Usage: npm run cli:migrate -- [--skip-backup] [--data-root /data/marcia-recipe]
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { applyDataRootFlag, parseArgs } from "./lib";

const { booleans } = parseArgs(process.argv.slice(2));
const { flags } = parseArgs(process.argv.slice(2));
applyDataRootFlag(flags);

const { ensureDataRoot, getDataRoot } = await import("@/lib/storage/dataRoot");
const { createBackup } = await import("@/lib/backups/service");
const { migrateDocument } = await import("@/lib/storage/migrations");
const { writeJsonAtomic } = await import("@/lib/storage/atomic");
const { rebuildSearchIndex } = await import("@/lib/storage/indexes");
const schemas = await import("@/lib/validation/schemas");
const { SCHEMA_VERSIONS } = await import("@/lib/validation/constants");
const { audit } = await import("@/lib/audit/log");

type Kind = keyof typeof SCHEMA_VERSIONS;

const TARGETS: { dir: (root: string) => string; kind: Kind; schema: keyof typeof schemas; deep?: boolean }[] = [
  { dir: (r) => join(r, "config"), kind: "siteConfig", schema: "siteConfigSchema" },
  { dir: (r) => join(r, "accounts"), kind: "account", schema: "accountSchema" },
  { dir: (r) => join(r, "invitations"), kind: "invitation", schema: "invitationSchema" },
  { dir: (r) => join(r, "recipes"), kind: "recipe", schema: "recipeSchema", deep: true },
  { dir: (r) => join(r, "users"), kind: "mealPlan", schema: "mealPlanSchema", deep: true },
];

async function collectJsonFiles(dir: string, deep: boolean, suffix: string | null): Promise<string[]> {
  const results: string[] = [];
  const walk = async (current: string, depth: number): Promise<void> => {
    if (depth > 5) return;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory() && deep) await walk(full, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        if (suffix && entry.name !== suffix) continue;
        results.push(full);
      }
    }
  };
  await walk(dir, 0);
  return results;
}

await ensureDataRoot();

if (!booleans.has("skip-backup")) {
  console.log("Creating pre-migration backup (required)…");
  const backup = await createBackup(null);
  console.log(`  backups/${backup.fileName}`);
}

const root = getDataRoot();
let migrated = 0;
let skipped = 0;
let failed = 0;

for (const target of TARGETS) {
  const files = await collectJsonFiles(
    target.dir(root),
    target.deep ?? false,
    target.kind === "recipe" ? "recipe.json" : target.kind === "siteConfig" ? "site.json" : null,
  );
  for (const file of files) {
    // Meal plans vs shopping lists share the users/ tree — disambiguate by path.
    let kind: Kind = target.kind;
    if (file.includes("shopping-lists")) kind = "shoppingList";
    const schemaName = kind === "shoppingList" ? "shoppingListSchema" : target.schema;
    try {
      const raw = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
      const version = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 0;
      if (version >= SCHEMA_VERSIONS[kind]) {
        skipped += 1;
        continue;
      }
      const { doc, applied } = migrateDocument(kind, raw);
      const validated = (schemas[schemaName] as { safeParse: (v: unknown) => { success: boolean; error?: { message: string } } }).safeParse(doc);
      if (!validated.success) {
        console.error(`  FAILED validation after migration: ${file} — ${validated.error?.message}`);
        failed += 1;
        continue;
      }
      await writeJsonAtomic(file, doc);
      console.log(`  migrated ${kind} v${version} → v${SCHEMA_VERSIONS[kind]}: ${file} (${applied.map((m) => m.description).join("; ")})`);
      migrated += 1;
    } catch (err) {
      console.error(`  FAILED: ${file} — ${err instanceof Error ? err.message : String(err)}`);
      failed += 1;
    }
  }
}

await rebuildSearchIndex();
await audit({
  type: "migration.applied",
  actorAccountId: null,
  clientAddress: null,
  detail: { migrated, skipped, failed },
});
console.log(`Done: ${migrated} migrated, ${skipped} already current, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
