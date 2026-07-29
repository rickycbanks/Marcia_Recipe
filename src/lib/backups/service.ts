import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import * as tar from "tar-stream";
import type { Account } from "@/types";
import { audit } from "@/lib/audit/log";
import { forbidden } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { SCHEMA_VERSIONS } from "@/lib/validation/constants";
import { getDataRoot } from "@/lib/storage/dataRoot";
import { withLock, withWriteLock } from "@/lib/storage/lock";
import { resolveWithin } from "@/lib/storage/paths";

/**
 * Backups run under the backup lock AND the global write lock, so an archive
 * can never capture a partially written mutation. Derived/disposable data
 * (indexes, locks, tmp, audit, previous backups) is excluded.
 */
const BACKUP_INCLUDE_DIRS = ["config", "accounts", "invitations", "recipes", "users"] as const;

export interface BackupInfo {
  fileName: string;
  bytes: number;
  createdAt: string;
}

const BACKUP_NAME_RE = /^marcia-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.tar\.gz$/;

async function* walkFiles(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full);
    } else if (entry.isFile()) {
      // Skip quarantined copies and orphaned tmp files — not canonical data.
      if (entry.name.includes(".tmp-") || entry.name.includes(".corrupt-")) continue;
      yield full;
    }
  }
}

export async function createBackup(actor: Account | null): Promise<BackupInfo> {
  if (actor !== null && actor.type !== "owner") throw forbidden("Only the owner can create backups");
  return withLock("backup", () =>
    withWriteLock(async () => {
      const root = getDataRoot();
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `marcia-backup-${stamp}.tar.gz`;
      const backupsDir = resolveWithin("backups");
      await mkdir(backupsDir, { recursive: true });

      const files: { path: string; size: number }[] = [];
      for (const dir of BACKUP_INCLUDE_DIRS) {
        for await (const file of walkFiles(join(root, dir))) {
          files.push({ path: file, size: (await stat(file)).size });
        }
      }
      files.sort((a, b) => a.path.localeCompare(b.path));

      const manifest = {
        formatVersion: SCHEMA_VERSIONS.backupManifest,
        createdAt: new Date().toISOString(),
        schemaVersions: SCHEMA_VERSIONS,
        fileCount: files.length,
        includes: BACKUP_INCLUDE_DIRS,
      };

      const pack = tar.pack();
      const gzip = createGzip({ level: 9 });
      const outPath = join(backupsDir, fileName);
      const done = pipeline(pack, gzip, createWriteStream(outPath));

      const manifestBody = JSON.stringify(manifest, null, 2);
      await new Promise<void>((resolveEntry, rejectEntry) => {
        pack.entry({ name: "manifest.json", size: Buffer.byteLength(manifestBody) }, manifestBody, (err) =>
          err ? rejectEntry(err) : resolveEntry(),
        );
      });
      for (const file of files) {
        const name = relative(root, file.path);
        await new Promise<void>((resolveEntry, rejectEntry) => {
          const entryStream = pack.entry({ name, size: file.size }, (err) =>
            err ? rejectEntry(err) : resolveEntry(),
          );
          createReadStream(file.path)
            .on("error", rejectEntry)
            .pipe(entryStream);
        });
      }
      pack.finalize();
      await done;

      const info = await stat(outPath);
      const result: BackupInfo = {
        fileName,
        bytes: info.size,
        createdAt: manifest.createdAt,
      };
      await audit({
        type: "backup.created",
        actorAccountId: actor?.id ?? null,
        clientAddress: null,
        detail: { fileName, bytes: info.size, fileCount: files.length },
      });
      logger.info("Backup created", result);
      return result;
    }),
  );
}

export async function listBackups(): Promise<BackupInfo[]> {
  const dir = resolveWithin("backups");
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const backups: BackupInfo[] = [];
  for (const fileName of entries) {
    if (!BACKUP_NAME_RE.test(fileName)) continue;
    const info = await stat(join(dir, fileName));
    backups.push({ fileName, bytes: info.size, createdAt: info.mtime.toISOString() });
  }
  return backups.sort((a, b) => b.fileName.localeCompare(a.fileName));
}

/** Resolve a backup file name for download — validated, no traversal. */
export function backupFilePath(fileName: string): string {
  if (!BACKUP_NAME_RE.test(fileName)) throw forbidden("Invalid backup file name");
  return resolveWithin("backups", fileName);
}
