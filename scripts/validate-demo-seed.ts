#!/usr/bin/env tsx
/**
 * Validate the integrity of a repo-managed demo seed directory.
 *
 * Usage:
 *   npm run cli:validate-demo-seed -- --output-dir scripts/demo-seed
 *
 * The validator reports the same kind of structural failure that caused the
 * original image-mismatch bug — every recipe/media association must be:
 *   - keyed by media id (NOT array position),
 *   - backed by a real .webp file on disk,
 *   - bitwise identical to the manifest's sha256.
 *
 * Exit code is non-zero on any inconsistency so this is safe to run in CI/PR
 * checks against seed changes.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "./lib";

const { flags } = parseArgs(process.argv.slice(2));
const outputDir = flags["output-dir"] ?? "scripts/demo-seed";
const seedDirAbs = resolve(outputDir);

if (!existsSync(seedDirAbs)) {
  console.error(`Seed directory does not exist: ${seedDirAbs}`);
  process.exit(1);
}
const manifestPath = join(seedDirAbs, "manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`Missing manifest.json in ${seedDirAbs}`);
  process.exit(1);
}

interface MediaEntry {
  id: string;
  isPrimary: boolean;
  fileName: string;
  sha256: string;
}
interface ManifestRecipe {
  id: string;
  slug: string;
  title: string;
  media: MediaEntry[];
  recipeJson: string;
}
interface Manifest {
  formatVersion: 1;
  recipes: ManifestRecipe[];
  accounts: { id: string; username: string; type: string }[];
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
const problems: string[] = [];
let primariesWithMissingFile = 0;
let mediaFilesChecked = 0;

console.log("Recipe                            Primary media id                  Media files");
console.log("--------------------------------- --------------------------------- -----------");
for (const entry of manifest.recipes) {
  const primary = entry.media.find((m) => m.isPrimary) ?? entry.media[0];
  console.log(
    `${entry.title.padEnd(33)} ${(primary?.id ?? "(none)").padEnd(33)} ${String(entry.media.length).padStart(11)}`,
  );
  if (primary && !existsSync(join(seedDirAbs, "recipes", entry.id, "media", primary.fileName))) {
    primariesWithMissingFile += 1;
  }
  for (const m of entry.media) {
    const filePath = join(seedDirAbs, "recipes", entry.id, "media", m.fileName);
    if (!existsSync(filePath)) {
      problems.push(`recipes/${entry.id}/media/${m.fileName}: missing file`);
      continue;
    }
    const buf = await readFile(filePath);
    const sha = createHash("sha256").update(buf).digest("hex");
    mediaFilesChecked += 1;
    if (sha !== m.sha256) {
      problems.push(`recipes/${entry.id}/media/${m.fileName}: sha256 ${sha} != manifest ${m.sha256}`);
    }
    if (m.fileName !== `${m.id}.webp`) {
      problems.push(`recipes/${entry.id}/media/${m.fileName}: fileName does not match id ${m.id}`);
    }
  }
  // Detect orphan files in the media directory.
  const mediaDir = join(seedDirAbs, "recipes", entry.id, "media");
  if (existsSync(mediaDir)) {
    const onDisk = new Set((await readdir(mediaDir)).filter((f) => f.endsWith(".webp")));
    for (const m of entry.media) onDisk.delete(m.fileName);
    for (const orphan of onDisk) {
      problems.push(`recipes/${entry.id}/media/${orphan}: orphan media file not in manifest`);
    }
  }
}

console.log("");
console.log(
  `Checked ${manifest.recipes.length} recipes, ${mediaFilesChecked} media files; ${primariesWithMissingFile} primaries with missing file.`,
);
if (problems.length > 0) {
  console.error("");
  console.error(`Seed invalid: ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("Seed OK.");