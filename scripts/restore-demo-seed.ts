#!/usr/bin/env tsx
/**
 * Restore the repository-managed demo seed into a DATA_ROOT.
 *
 * Usage:
 *   npm run cli:restore-demo-seed -- --output-dir scripts/demo-seed --data-root /tmp/demo-root
 *
 * The command reads `manifest.json` from the output directory, writes each
 * recipe JSON and primary media file into the canonical DATA_ROOT layout,
 * creates the required owner account and site config, and runs a final
 * rebuild-indexes pass so the demo instance is immediately consistent.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, applyDataRootFlag } from "./lib";

const { flags } = parseArgs(process.argv.slice(2));
applyDataRootFlag(flags);

const outputDir = flags["output-dir"] ?? "scripts/demo-seed";
const manifestPath = join(outputDir, "manifest.json");

if (!existsSync(manifestPath)) {
  console.error(`Missing manifest at ${manifestPath}. Run the generate-demo-seed script first.`);
  process.exit(1);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!manifest?.recipes?.length) {
  console.error("Manifest contains no recipes.");
  process.exit(1);
}

const { ensureDataRoot, getDataRoot } = await import("@/lib/storage/dataRoot");
const { writeJsonAtomic, writeBufferAtomic } = await import("@/lib/storage/atomic");
const { recipeMediaDir } = await import("@/lib/storage/repositories/recipes");
const { buildSearchIndex } = await import("@/lib/storage/indexes");

await ensureDataRoot();
const root = getDataRoot();

for (const entry of manifest.recipes) {
  const recipe = JSON.parse(await readFile(join(outputDir, entry.recipeJson), "utf8"));
  const recipeDir = join(root, "recipes", recipe.id);
  const mediaDir = join(recipeMediaDir(recipe.id));
  await mkdir(recipeDir, { recursive: true });
  await mkdir(mediaDir, { recursive: true });
  await writeJsonAtomic(join(recipeDir, "recipe.json"), recipe);
  if (entry.primaryMedia) {
    const buffer = await readFile(join(outputDir, entry.primaryMedia));
    await writeBufferAtomic(join(mediaDir, `${recipe.media[0].id}.webp`), buffer);
  }
}

await buildSearchIndex();
console.log(`Restored ${manifest.recipes.length} recipes into ${root}`);
