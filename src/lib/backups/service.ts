import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
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

const BACKUP_NAME_RE = /^marcia-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(?:-\d+)?\.tar\.gz$/;

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
  return withLock("backup", () => withWriteLock(() => createBackupWhileLocked(actor)));
}

/**
 * Create a safety snapshot while the caller already holds both locks. Restore
 * uses this to avoid taking the backup/write locks a second time mid-operation.
 */
export async function createBackupWhileLocked(actor: Account | null): Promise<BackupInfo> {
  if (actor !== null && actor.type !== "owner") throw forbidden("Only the owner can create backups");

  const root = getDataRoot();
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[:.]/g, "-");
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
    createdAt,
    schemaVersions: SCHEMA_VERSIONS,
    fileCount: files.length,
    includes: BACKUP_INCLUDE_DIRS,
  };

  const pack = tar.pack();
  const gzip = createGzip({ level: 9 });
  const temporaryPath = join(backupsDir, `.marcia-backup-${randomUUID()}.tar.gz.tmp`);
  let done: Promise<void> | undefined;
  let finalPath: string | undefined;
  let committed = false;

  try {
    done = pipeline(pack, gzip, createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }));
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

    // Ensure the archive contents reach stable storage before publishing its
    // final name. The final name is claimed exclusively, then the rename is
    // atomic and can never overwrite a same-millisecond backup.
    const temporaryHandle = await open(temporaryPath, "r");
    await temporaryHandle.sync();
    await temporaryHandle.close();
    finalPath = await reserveFinalPath(backupsDir, stamp);
    await rename(temporaryPath, finalPath);
    committed = true;
    await fsyncDirectory(dirname(finalPath));
  } catch (err) {
    pack.destroy(err instanceof Error ? err : new Error(String(err)));
    if (done) await done.catch(() => undefined);
    if (!committed) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      if (finalPath) await rm(finalPath, { force: true }).catch(() => undefined);
    }
    throw err;
  }

  const fileName = finalPath!.slice(backupsDir.length + 1);
  const info = await stat(finalPath!);
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
}

async function reserveFinalPath(backupsDir: string, stamp: string): Promise<string> {
  for (let suffix = 0; suffix < 10_000; suffix += 1) {
    const fileName = `marcia-backup-${stamp}${suffix === 0 ? "" : `-${suffix}`}.tar.gz`;
    const path = join(backupsDir, fileName);
    try {
      const handle = await open(path, "wx", 0o600);
      await handle.close();
      return path;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw err;
    }
  }
  throw new Error("Could not allocate a unique backup filename");
}

async function fsyncDirectory(path: string): Promise<void> {
  try {
    const handle = await open(path, "r");
    await handle.sync();
    await handle.close();
  } catch {
    // Directory fsync is not supported by every filesystem/runtime. The
    // archive file was fsynced before rename, which is the important part.
  }
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
