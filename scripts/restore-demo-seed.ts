#!/usr/bin/env tsx
/**
 * Restore the repository-managed demo seed into a DATA_ROOT.
 *
 * Usage:
 *   npm run cli:restore-demo-seed -- \
 *     --output-dir scripts/demo-seed \
 *     --data-root /tmp/demo-root \
 *     [--force]
 *
 * The seed directory is the canonical, immutable, repo-managed source of truth
 * for the public demo. It is laid out exactly like a normal DATA_ROOT so this
 * loader can build a standard Marcia backup tarball in memory and delegate to
 * the rigorous `restoreBackup` engine — that engine re-validates every
 * document, every recipe/media association (by id), every account, the
 * required owner, and the site config, then performs the atomic root swap.
 *
 * Because the tarball files are named after the media id they contain (per
 * `mediaItemSchema`), and the standard restore validates that each
 * `recipe.media[i].fileName === "${id}.webp"` AND that a matching archive
 * member exists, the previous positional `recipe.media[0].id` assignment bug
 * is structurally impossible here.
 *
 * Seed layout (`--output-dir`):
 *   <seedDir>/manifest.json            ← seed manifest (our format; see below)
 *   <seedDir>/config/site.json
 *   <seedDir>/accounts/<accountId>.json
 *   <seedDir>/recipes/<recipeId>/recipe.json
 *   <seedDir>/recipes/<recipeId>/media/<mediaId>.webp
 *
 * Our `manifest.json` (seed manifest, NOT the backup manifest) shape:
 *   {
 *     formatVersion: 1,
 *     generatedAt: "<iso>",
 *     origin: "<origin url that produced the seed>",
 *     recipes: [
 *       {
 *         id, slug, title,
 *         media: [{ id, isPrimary, fileName, sha256 }],
 *         recipeJson: "recipes/<id>/recipe.json"
 *       }
 *     ],
 *     accounts: [{ id, username, type }],
 *     siteConfig: "config/site.json"
 *   }
 *
 * `restore-demo-seed` exits non-zero on any validation failure so workflow
 * operators see the failure immediately instead of silently seeding corrupted
 * data again.
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import * as tar from "tar-stream";
import { parseArgs, applyDataRootFlag } from "./lib";

export interface SeedManifestMedia {
  id: string;
  isPrimary: boolean;
  fileName: string;
  sha256: string;
}
export interface SeedManifestRecipe {
  id: string;
  slug: string;
  title: string;
  media: SeedManifestMedia[];
  recipeJson: string;
}
export interface SeedManifest {
  formatVersion: number;
  generatedAt: string;
  origin: string;
  recipes: SeedManifestRecipe[];
  accounts: { id: string; username: string; type: string }[];
  siteConfig: string;
}

const BACKUP_MEMBER_RE = /^[A-Za-z0-9._/-]+$/;
function assertCanonicalMember(name: string): void {
  if (!BACKUP_MEMBER_RE.test(name)) throw new Error(`Unsafe archive member name: ${name}`);
}

async function sha256OfFile(absPath: string): Promise<string> {
  const buf = await readFile(absPath);
  return createHash("sha256").update(buf).digest("hex");
}

export async function collectSeedFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectSeedFiles(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

async function buildStandardArchive(
  seedDirAbs: string,
  seedFiles: string[],
): Promise<{ archivePath: string; temporaryDirectory: string }> {
  const { SCHEMA_VERSIONS } = await import("@/lib/validation/constants");

  // The standard backup `manifest.json` declares fileCount excluding itself.
  const fileCount = seedFiles.length;
  const backupManifest = {
    formatVersion: SCHEMA_VERSIONS.backupManifest,
    createdAt: new Date().toISOString(),
    schemaVersions: SCHEMA_VERSIONS,
    fileCount,
    includes: ["config", "accounts", "invitations", "recipes", "users"],
  };

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "marcia-restore-demo-seed-"));
  const archivePath = join(temporaryDirectory, "demo-seed.tar.gz");

  const pack = tar.pack();
  const gzip = createGzip({ level: 9 });
  const done = pipeline(pack, gzip, createWriteStream(archivePath));

  const writeEntry = (name: string, body: Buffer): Promise<void> =>
    new Promise((resolveEntry, rejectEntry) => {
      pack.entry({ name, size: body.byteLength }, body, (err) =>
        err ? rejectEntry(err) : resolveEntry(),
      );
    });

  await writeEntry("manifest.json", Buffer.from(JSON.stringify(backupManifest, null, 2) + "\n", "utf8"));

  for (const abs of seedFiles) {
    const name = relative(seedDirAbs, abs);
    assertCanonicalMember(name);
    const buf = await readFile(abs);
    await writeEntry(name, buf);
  }
  pack.finalize();
  await done;

  return { archivePath, temporaryDirectory };
}

export interface RestoreDemoSeedResult {
  recipes: number;
  mediaFiles: number;
  restored: boolean;
}

/** Validate a seed directory; throws when any association is broken. */
export async function validateSeedDir(seedDirAbs: string): Promise<SeedManifest> {
  if (!existsSync(seedDirAbs)) {
    throw new Error(`Missing seed directory at ${seedDirAbs}.`);
  }
  const manifestPath = join(seedDirAbs, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing seed manifest at ${manifestPath}.`);
  }

  let seedManifest: SeedManifest;
  try {
    seedManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (err) {
    throw new Error(`Could not parse seed manifest: ${(err as Error).message}`);
  }
  if (seedManifest.formatVersion !== 1) {
    throw new Error(`Unsupported seed manifest formatVersion ${seedManifest.formatVersion}.`);
  }
  if (!seedManifest.recipes?.length) {
    throw new Error("Seed manifest contains no recipes — refusing to restore an empty demo.");
  }

  const problems: string[] = [];
  const { recipeSchema, accountSchema, siteConfigSchema } = await import("@/lib/validation/schemas");

  // Pre-validate: every recipe JSON parses, every declared media file exists,
  // every media file decodes to its declared sha256, no orphan media exists.
  // The standard restoreBackup re-runs similar checks, but failing here
  // produces a clearer error before we touch the DATA_ROOT.
  for (const entry of seedManifest.recipes) {
    const recipePath = join(seedDirAbs, entry.recipeJson);
    if (!existsSync(recipePath)) {
      problems.push(`${entry.recipeJson}: missing recipe JSON`);
      continue;
    }
    const parsed = recipeSchema.safeParse(JSON.parse(await readFile(recipePath, "utf8")));
    if (!parsed.success) {
      problems.push(`${entry.recipeJson}: ${parsed.error.issues[0]?.message ?? "schema validation failed"}`);
      continue;
    }
    const recipe = parsed.data;
    if (recipe.id !== entry.id) {
      problems.push(`${entry.recipeJson}: recipe id ${recipe.id} does not match manifest id ${entry.id}`);
    }
    for (const media of entry.media) {
      const filePath = join(seedDirAbs, "recipes", recipe.id, "media", media.fileName);
      if (!existsSync(filePath)) {
        problems.push(`recipes/${recipe.id}/media/${media.fileName}: media file missing from seed`);
        continue;
      }
      const sha = await sha256OfFile(filePath);
      if (sha !== media.sha256) {
        problems.push(`recipes/${recipe.id}/media/${media.fileName}: sha256 ${sha} != manifest ${media.sha256}`);
      }
      if (media.fileName !== `${media.id}.webp`) {
        problems.push(`recipes/${recipe.id}/media/${media.fileName}: fileName does not match id ${media.id}`);
      }
      // Cross-check the recipe's own media array references the same id.
      const inRecipe = recipe.media.find((m) => m.id === media.id);
      if (!inRecipe || inRecipe.fileName !== media.fileName) {
        problems.push(`${entry.recipeJson}: recipe.media does not reference ${media.fileName}`);
      }
    }
    // Detect orphan media files on disk that the manifest never declared.
    const mediaDir = join(seedDirAbs, "recipes", recipe.id, "media");
    if (existsSync(mediaDir)) {
      const onDisk = new Set((await readdir(mediaDir)).filter((f) => f.endsWith(".webp")));
      for (const m of entry.media) onDisk.delete(m.fileName);
      for (const orphan of onDisk) {
        problems.push(`recipes/${recipe.id}/media/${orphan}: orphan media file not in manifest`);
      }
    }
  }

  // Validate account + site config presence before touching DATA_ROOT.
  const accountsPath = join(seedDirAbs, "accounts");
  if (existsSync(accountsPath)) {
    const files = (await readdir(accountsPath)).filter((f) => f.endsWith(".json"));
    let enabledOwner = false;
    for (const f of files) {
      const parsed = accountSchema.safeParse(JSON.parse(await readFile(join(accountsPath, f), "utf8")));
      if (!parsed.success) {
        problems.push(`accounts/${f}: ${parsed.error.issues[0]?.message ?? "schema validation failed"}`);
        continue;
      }
      if (parsed.data.type === "owner" && parsed.data.disabledAt === null) enabledOwner = true;
    }
    if (!enabledOwner) problems.push("accounts: at least one enabled owner account is required");
  } else {
    problems.push("accounts/: directory is missing");
  }

  const siteConfigPath = join(seedDirAbs, "config", "site.json");
  if (!existsSync(siteConfigPath)) {
    problems.push("config/site.json: missing site config");
  } else {
    const parsed = siteConfigSchema.safeParse(JSON.parse(await readFile(siteConfigPath, "utf8")));
    if (!parsed.success) problems.push(`config/site.json: ${parsed.error.issues[0]?.message ?? "schema validation failed"}`);
  }

  if (problems.length > 0) {
    throw new Error("Seed validation failed:\n  - " + problems.join("\n  - "));
  }
  return seedManifest;
}

/**
 * Restore a repo-managed seed directory into the current DATA_ROOT. The caller
 * must arrange `process.env.DATA_ROOT` (and call `resetEnvCache()` if it
 * changed since the last module load). `force` matches the standard restore
 * semantics needed to overwrite an existing live DATA_ROOT.
 */
export async function restoreDemoSeed(opts: {
  seedDirAbs: string;
  force?: boolean;
}): Promise<RestoreDemoSeedResult> {
  const seedManifest = await validateSeedDir(opts.seedDirAbs);

  const seedFiles: string[] = [];
  for (const dir of ["config", "accounts", "recipes", "invitations", "users"]) {
    const abs = join(opts.seedDirAbs, dir);
    if (existsSync(abs)) seedFiles.push(...(await collectSeedFiles(abs)));
  }
  seedFiles.sort((a, b) => relative(opts.seedDirAbs, a).localeCompare(relative(opts.seedDirAbs, b)));

  const { ensureDataRoot } = await import("@/lib/storage/dataRoot");
  await ensureDataRoot();

  const { archivePath, temporaryDirectory } = await buildStandardArchive(opts.seedDirAbs, seedFiles);
  try {
    const { restoreBackup } = await import("@/lib/backups/restore");
    const report = await restoreBackup(archivePath, { force: opts.force ?? false });
    return {
      recipes: seedManifest.recipes.length,
      mediaFiles: report.mediaFiles,
      restored: report.restored,
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function main() {
  const { flags, booleans } = parseArgs(process.argv.slice(2));
  applyDataRootFlag(flags);
  const seedDir = flags["output-dir"] ?? "scripts/demo-seed";
  const force = booleans.has("force");
  const seedDirAbs = resolve(seedDir);

  try {
    const result = await restoreDemoSeed({ seedDirAbs, force });
    console.log(`Restored ${result.recipes} recipes from ${seedDirAbs}.`);
    console.log(`  media files:          ${result.mediaFiles}`);
    if (result.restored) console.log("  atomic root swap complete.");
    else console.error("  restore reported NOT restored");
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// CLI entrypoint.  Skip when imported (vitest).
const invokedDirectly = process.argv[1] && (process.argv[1].endsWith("restore-demo-seed.ts") || process.argv[1].endsWith("restore-demo-seed"));
if (invokedDirectly) {
  await main();
}