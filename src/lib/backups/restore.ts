import { createReadStream } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import * as tar from "tar-stream";
import { AppError, badRequest } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  accountSchema,
  invitationSchema,
  mealPlanSchema,
  recipeSchema,
  shoppingListSchema,
  siteConfigSchema,
} from "@/lib/validation/schemas";
import { SCHEMA_VERSIONS } from "@/lib/validation/constants";
import { getDataRoot } from "@/lib/storage/dataRoot";
import { withLock, withWriteLock } from "@/lib/storage/lock";
import { rebuildSearchIndex } from "@/lib/storage/indexes";

/**
 * Restore validation + dry-run. Every JSON document in the archive is
 * schema-validated BEFORE anything is written; restores run under the backup
 * and write locks and rebuild derived indexes afterwards.
 */

const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB uncompressed safety cap
const UUID_PATH = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const MEDIA_ENTRY_RE = new RegExp(`^recipes/${UUID_PATH}/media/${UUID_PATH}\\.webp$`);

interface ArchiveEntry {
  name: string;
  body: Buffer;
}

export interface RestoreReport {
  manifest: { formatVersion: number; createdAt: string; fileCount: number };
  entries: number;
  jsonDocumentsValidated: number;
  mediaFiles: number;
  dryRun: boolean;
  restored: boolean;
  problems: string[];
}

async function extractArchive(archivePath: string): Promise<ArchiveEntry[]> {
  const extract = tar.extract();
  const entries: ArchiveEntry[] = [];
  let total = 0;

  extract.on("entry", (header, stream, next) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > MAX_ARCHIVE_BYTES) {
        stream.destroy(new AppError("PAYLOAD_TOO_LARGE", "Archive exceeds the restore size cap"));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("end", () => {
      if (header.type === "file") {
        entries.push({ name: header.name.replace(/^\.\//, ""), body: Buffer.concat(chunks) });
      }
      next();
    });
    stream.on("error", next);
    stream.resume();
  });

  await pipeline(createReadStream(archivePath), createGunzip(), extract);
  return entries;
}

/** Path-prefix → schema routing for validation of every archived document. */
function validateEntryDocument(name: string, body: Buffer): string | null {
  if (!name.endsWith(".json")) {
    return MEDIA_ENTRY_RE.test(name) ? null : `${name}: unsupported non-JSON backup member`;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return `${name}: invalid JSON`;
  }
  const pick = () => {
    if (name === "manifest.json") return null;
    if (name === "config/site.json") return siteConfigSchema;
    if (/^accounts\/[^/]+\.json$/.test(name)) return accountSchema;
    if (/^invitations\/[^/]+\.json$/.test(name)) return invitationSchema;
    if (/^recipes\/[^/]+\/recipe\.json$/.test(name)) return recipeSchema;
    if (/^users\/[^/]+\/meal-plans\/[^/]+\.json$/.test(name)) return mealPlanSchema;
    if (/^users\/[^/]+\/shopping-lists\/[^/]+\.json$/.test(name)) return shoppingListSchema;
    return "unknown" as const;
  };
  const schema = pick();
  if (schema === null) return null;
  if (schema === "unknown") return `${name}: does not match any known document location`;
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    return `${name}: ${issue?.path.join(".")} ${issue?.message}`;
  }
  return null;
}

/** Reject archive member paths that could escape DATA_ROOT on extraction. */
function isSafeEntryName(name: string): boolean {
  return (
    name.length > 0 &&
    !name.startsWith("/") &&
    !name.includes("..") &&
    !name.includes("\0") &&
    /^[\w\-./]+$/.test(name)
  );
}

export async function restoreBackup(
  archivePath: string,
  options: { dryRun?: boolean; force?: boolean } = {},
): Promise<RestoreReport> {
  const dryRun = options.dryRun ?? false;
  const entries = await extractArchive(archivePath);
  const problems: string[] = [];

  const manifestEntry = entries.find((e) => e.name === "manifest.json");
  if (!manifestEntry) throw badRequest("Archive has no manifest.json — not a Marcia Recipe backup");
  let manifest: { formatVersion: number; createdAt: string; fileCount: number };
  try {
    const parsed = JSON.parse(manifestEntry.body.toString("utf8")) as {
      formatVersion?: number;
      createdAt?: string;
      fileCount?: number;
    };
    if (typeof parsed.formatVersion !== "number" || parsed.formatVersion > SCHEMA_VERSIONS.backupManifest) {
      throw badRequest(`Backup format version ${parsed.formatVersion} is newer than this build supports`);
    }
    manifest = {
      formatVersion: parsed.formatVersion,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "unknown",
      fileCount: typeof parsed.fileCount === "number" ? parsed.fileCount : 0,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw badRequest("Backup manifest is malformed");
  }

  let jsonValidated = 0;
  let mediaFiles = 0;
  const names = new Set<string>();
  for (const entry of entries) {
    if (!isSafeEntryName(entry.name)) {
      problems.push(`${entry.name}: unsafe path in archive`);
      continue;
    }
    if (names.has(entry.name)) {
      problems.push(`${entry.name}: duplicate path in archive`);
      continue;
    }
    names.add(entry.name);
    const problem = validateEntryDocument(entry.name, entry.body);
    if (problem) problems.push(problem);
    else if (entry.name.endsWith(".json")) jsonValidated += 1;
    else mediaFiles += 1;
  }
  if (manifest.fileCount !== entries.length - 1) {
    problems.push(`manifest fileCount ${manifest.fileCount} does not match ${entries.length - 1} archived files`);
  }

  const report = {
    manifest,
    entries: entries.length,
    jsonDocumentsValidated: jsonValidated,
    mediaFiles,
    dryRun,
    restored: false,
    problems,
  };
  if (problems.length > 0 || dryRun) return report;

  const root = getDataRoot();
  const targetDirs = ["config", "accounts", "invitations", "recipes", "users"];
  await withLock("backup", () =>
    withWriteLock(async () => {
      // Refuse to clobber existing data unless explicitly forced.
      let hasExisting = false;
      for (const dir of targetDirs) {
        try {
          const existing = await readdir(join(root, dir));
          if (existing.length > 0) hasExisting = true;
        } catch {
          /* missing dir is fine */
        }
      }
      if (hasExisting && !options.force) {
        throw badRequest("DATA_ROOT is not empty; re-run with --force to replace existing data");
      }
      for (const dir of targetDirs) {
        await rm(join(root, dir), { recursive: true, force: true });
        await mkdir(join(root, dir), { recursive: true });
      }
      for (const entry of entries) {
        if (entry.name === "manifest.json") continue;
        const dest = join(root, entry.name);
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, entry.body);
      }
      await rebuildSearchIndex();
      logger.info("Backup restored", { archivePath, entries: entries.length });
    }),
  );

  return { ...report, restored: true };
}
