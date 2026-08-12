#!/usr/bin/env tsx
/**
 * Export the canonical demo catalog from a known-good Marcia instance into a
 * repository-managed seed directory.
 *
 * Usage:
 *   npm run cli:generate-demo-seed -- \
 *     --app-origin https://recipes-demo.inthesky.dev \
 *     --username demo \
 *     --password 'demo123456' \
 *     --output-dir scripts/demo-seed
 *
 * The script:
 *   1. Authenticates as the owner.
 *   2. Triggers a fresh standard backup (POST /api/backups) so the source is
 *      internally consistent.
 *   3. Downloads the latest backup tarball (GET /api/backups/<file>).
 *   4. Extracts it into the canonical loose layout under --output-dir:
 *        <seedDir>/config/site.json
 *        <seedDir>/accounts/<id>.json
 *        <seedDir>/recipes/<id>/recipe.json
 *        <seedDir>/recipes/<id>/media/<mediaId>.webp
 *   5. Computes sha256 of every media webp and writes a seed manifest.json
 *      describing recipe <-> media -> file -> sha256 associations. Restore
 *      and validation both consume this manifest.
 *   6. Writes a human-reviewable README.md summarising each recipe and its
 *      primary media id so a human reviewer can verify the visible image
 *      matches the title before committing the seed.
 *
 * IMPORTANT: only run this against a known-good demo state.  The generated
 * seed becomes the immutable canonical source for future resets, so any
 * visible recipe-image mismatch (burger showing pizza, etc.) committed here
 * will be re-applied on every reset until the seed is regenerated.
 */
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import * as tar from "tar-stream";
import { parseArgs } from "./lib";

const { flags } = parseArgs(process.argv.slice(2));
const origin = flags["app-origin"] ?? "https://recipes-demo.inthesky.dev";
const username = flags["username"] ?? "demo";
const password = flags["password"] ?? "demo123456";
const outputDir = flags["output-dir"] ?? "scripts/demo-seed";

interface Session {
  cookies: string;
}

interface BackupInfo {
  fileName: string;
  bytes: number;
  createdAt: string;
}

interface MediaEntry {
  id: string;
  isPrimary: boolean;
  fileName: string;
  sha256: string;
}
interface SeedManifestRecipe {
  id: string;
  slug: string;
  title: string;
  media: MediaEntry[];
  recipeJson: string;
}
interface SeedManifest {
  formatVersion: 1;
  generatedAt: string;
  origin: string;
  recipes: SeedManifestRecipe[];
  accounts: { id: string; username: string; type: string }[];
  siteConfig: string;
}

function parseCookies(setCookies: string[]): string {
  const cookies: string[] = [];
  for (const header of setCookies) {
    const [pair] = header.split(";");
    if (pair) cookies.push(pair);
  }
  return cookies.join("; ");
}

async function login(): Promise<Session> {
  const csrfRes = await fetch(new URL("/api/auth/csrf", origin));
  const csrf = ((await csrfRes.json()) as { csrfToken: string }).csrfToken;
  const cookies = parseCookies(csrfRes.headers.getSetCookie());

  const callbackRes = await fetch(new URL("/api/auth/callback/credentials", origin), {
    method: "POST",
    headers: { cookie: cookies, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken: csrf, username, password }).toString(),
    redirect: "manual",
  });

  const mergedCookies = parseCookies([
    ...callbackRes.headers.getSetCookie(),
    ...cookies.split("; ").filter(Boolean),
  ]);
  return { cookies: mergedCookies };
}

async function triggerBackup(session: Session): Promise<BackupInfo> {
  const res = await fetch(new URL("/api/backups", origin), {
    method: "POST",
    headers: { cookie: session.cookies },
  });
  if (!res.ok) throw new Error(`POST /api/backups returned ${res.status}`);
  const body = (await res.json()) as { backup: BackupInfo };
  return body.backup;
}

async function listBackups(session: Session): Promise<BackupInfo[]> {
  const res = await fetch(new URL("/api/backups", origin), { headers: { cookie: session.cookies } });
  if (!res.ok) throw new Error(`GET /api/backups returned ${res.status}`);
  const body = (await res.json()) as { backups: BackupInfo[] };
  return body.backups;
}

async function downloadBackup(session: Session, fileName: string, dest: string): Promise<void> {
  const res = await fetch(new URL(`/api/backups/${encodeURIComponent(fileName)}`, origin), {
    headers: { cookie: session.cookies },
  });
  if (!res.ok || !res.body) throw new Error(`GET /api/backups/${fileName} returned ${res.status}`);
  await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(dest));
}

async function extractBackup(
  archivePath: string,
): Promise<{ extracted: Map<string, Buffer>; recipeFiles: string[]; accountFiles: string[]; siteConfig: Buffer | null }> {
  const { createReadStream } = await import("node:fs");
  const extracted = new Map<string, Buffer>();
  const recipeFiles: string[] = [];
  const accountFiles: string[] = [];
  let siteConfig: Buffer | null = null;

  const extract = tar.extract();
  await new Promise<void>((resolve, reject) => {
    extract.on("entry", (header, stream, next) => {
      void (async () => {
        try {
          if (header.type !== "file") {
            stream.resume();
            next();
            return;
          }
          // Skip the standard backup manifest; we author our own.
          if (header.name === "manifest.json") {
            stream.resume();
            next();
            return;
          }
          const chunks: Buffer[] = [];
          for await (const chunk of stream) chunks.push(Buffer.from(chunk));
          const body = Buffer.concat(chunks);
          extracted.set(header.name, body);
          if (header.name.startsWith("recipes/") && header.name.endsWith("/recipe.json")) {
            recipeFiles.push(header.name);
          } else if (header.name.startsWith("accounts/") && header.name.endsWith(".json")) {
            accountFiles.push(header.name);
          } else if (header.name === "config/site.json") {
            siteConfig = body;
          }
          next();
        } catch (err) {
          stream.on("error", () => undefined);
          next(err as Error);
        }
      })();
    });
    extract.on("finish", resolve);
    extract.on("error", reject);
  });
  await pipeline(createReadStream(archivePath), createGunzip(), extract);

  return { extracted, recipeFiles, accountFiles, siteConfig };
}

async function writeExtracted(seedDirAbs: string, extracted: Map<string, Buffer>): Promise<void> {
  for (const [name, body] of extracted) {
    const dest = join(seedDirAbs, name);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, body);
  }
}

async function computeSha256(absPath: string): Promise<string> {
  const buf = await readFile(absPath);
  return createHash("sha256").update(buf).digest("hex");
}

async function buildSeedManifest(
  seedDirAbs: string,
  origin: string,
  recipeFiles: string[],
  accountFiles: string[],
): Promise<SeedManifest> {
  const recipeSchema = (await import("@/lib/validation/schemas")).recipeSchema;
  const accountSchema = (await import("@/lib/validation/schemas")).accountSchema;

  const recipes: SeedManifestRecipe[] = [];
  for (const name of recipeFiles.sort()) {
    const raw = JSON.parse(await readFile(join(seedDirAbs, name), "utf8"));
    const parsed = recipeSchema.parse(raw);
    const media: MediaEntry[] = [];
    for (const item of parsed.media) {
      const fileName = item.fileName;
      const filePath = join(seedDirAbs, "recipes", parsed.id, "media", fileName);
      const sha256 = existsSync(filePath) ? await computeSha256(filePath) : "";
      media.push({ id: item.id, isPrimary: item.isPrimary, fileName, sha256 });
    }
    recipes.push({ id: parsed.id, slug: parsed.slug, title: parsed.title, media, recipeJson: name });
  }

  const accounts: { id: string; username: string; type: string }[] = [];
  for (const name of accountFiles.sort()) {
    const parsed = accountSchema.parse(JSON.parse(await readFile(join(seedDirAbs, name), "utf8")));
    accounts.push({ id: parsed.id, username: parsed.username, type: parsed.type });
  }

  return {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    origin,
    recipes,
    accounts,
    siteConfig: "config/site.json",
  };
}

async function main() {
  const seedDirAbs = isAbsolute(outputDir) ? outputDir : resolve(process.cwd(), outputDir);
  const tempDir = await mkdtemp(join(tmpdir(), "marcia-demo-seed-"));
  const archivePath = join(tempDir, "demo-backup.tar.gz");

  try {
    const session = await login();
    await triggerBackup(session);
    // Give the just-triggered backup a moment to land, then pick the newest.
    const backups = await listBackups(session);
    if (backups.length === 0) throw new Error("No backups available on the demo after triggering one");
    const latest = backups[0]!;
    console.log(`Downloading backup ${latest.fileName} (${(latest.bytes / 1024).toFixed(1)} KB)...`);
    await downloadBackup(session, latest.fileName, archivePath);

    // Reset the target directory so we never carry stale files left behind.
    if (existsSync(seedDirAbs)) await rm(seedDirAbs, { recursive: true, force: true });
    await mkdir(seedDirAbs, { recursive: true });

    const { extracted, recipeFiles, accountFiles, siteConfig } = await extractBackup(archivePath);
    await writeExtracted(seedDirAbs, extracted);
    if (siteConfig === null) {
      throw new Error("Standard backup did not contain config/site.json — the source demo is not fully configured");
    }

    const manifest = await buildSeedManifest(seedDirAbs, origin, recipeFiles, accountFiles);
    await writeFile(join(seedDirAbs, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

    // Human-reviewable README — operators must verify visually.
    const readme = [
      "# Demo seed assets",
      "",
      `Generated from ${origin} at ${manifest.generatedAt}.`,
      "",
      "This directory is the **immutable canonical source** for the public demo.",
      "Always verify every recipe's primary image visibly matches its title before",
      "committing — see `scripts/restore-demo-seed.ts` and `scripts/validate-demo-seed.ts`.",
      "",
      "## Recipes",
      "",
      "| Recipe | Slug | Primary media id | Media files |",
      "| --- | --- | --- | --- |",
      ...manifest.recipes.map(
        (r) =>
          `| ${r.title} | ${r.slug} | ${r.media.find((m) => m.isPrimary)?.id ?? "(none)"} | ${r.media.length} |`,
      ),
      "",
      "## Accounts",
      "",
      ...manifest.accounts.map((a) => `- ${a.username} (${a.type}, id ${a.id})`),
      "",
      "## Regenerating",
      "",
      "1. Point a Marcia instance at the known-good state (e.g. after uploading",
      "   correction images via the admin UI).",
      "2. Run:",
      "",
      "   ```sh",
      "   npm run cli:generate-demo-seed -- \\",
      "     --app-origin https://recipes-demo.inthesky.dev \\",
      "     --username demo --password 'demo123456' \\",
      "     --output-dir scripts/demo-seed",
      "   ```",
      "",
      "3. Visually confirm the README table above.",
      "4. Run `npm run cli:validate-demo-seed -- --output-dir scripts/demo-seed`.",
      "5. Commit `scripts/demo-seed/`.",
      "",
    ].join("\n");
    await writeFile(join(seedDirAbs, "README.md"), readme);

    console.log(`Wrote ${manifest.recipes.length} recipes to ${outputDir}`);
    console.log(`Next: review ${outputDir}/README.md, run npm run cli:validate-demo-seed, then commit.`);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

await main();