import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

/** Canonical subdirectory layout beneath DATA_ROOT. */
export const DATA_DIRS = [
  "config",
  "accounts",
  "invitations",
  "recipes",
  "users",
  "indexes",
  "audit",
  "backups",
  "locks",
  "tmp",
] as const;

export type DataDir = (typeof DATA_DIRS)[number];

/** Absolute, symlink-resolved path to DATA_ROOT (created on first use in dev). */
export function getDataRoot(): string {
  const { DATA_ROOT } = getEnv();
  return resolve(isAbsolute(DATA_ROOT) ? DATA_ROOT : resolve(process.cwd(), DATA_ROOT));
}

export function dataPath(...segments: string[]): string {
  return join(getDataRoot(), ...segments);
}

/** The deterministic rollback sibling used by an in-progress root swap. */
export function getRollbackRoot(root = getDataRoot()): string {
  return `${root}.rollback`;
}

/** The durable swap marker is deliberately a sibling, never part of DATA_ROOT. */
export function getSwapMarkerPath(root = getDataRoot()): string {
  return `${root}.restore-swap.json`;
}

export type DataRootSwapPhase = "prepared" | "old-root-moved" | "stage-installed" | "verified" | "rolled-back";

export interface DataRootSwapMarker {
  version: 1;
  root: string;
  staging: string;
  rollback: string;
  phase: DataRootSwapPhase;
}

async function durableWriteFile(path: string, contents: string): Promise<void> {
  const temporary = `${path}.tmp-${randomUUID()}`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    // Directory fsync is best effort: it is available on the POSIX filesystems
    // used for DATA_ROOT, but is not supported by every development platform.
    try {
      const directory = await open(dirname(path), "r");
      await directory.sync();
      await directory.close();
    } catch {
      // The file itself was still fsynced before the atomic rename.
    }
  } catch (err) {
    if (handle) await handle.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw err;
  }
}

export async function writeDataRootSwapMarker(marker: DataRootSwapMarker): Promise<void> {
  await durableWriteFile(getSwapMarkerPath(marker.root), JSON.stringify(marker) + "\n");
}

export async function readDataRootSwapMarker(root = getDataRoot()): Promise<DataRootSwapMarker | null> {
  let raw: string;
  try {
    raw = await readFile(getSwapMarkerPath(root), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new AppError("INTERNAL", "DATA_ROOT restore marker is malformed", err);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError("INTERNAL", "DATA_ROOT restore marker is malformed");
  }
  const value = parsed as Record<string, unknown>;
  const phases: DataRootSwapPhase[] = ["prepared", "old-root-moved", "stage-installed", "verified", "rolled-back"];
  if (
    value.version !== 1 ||
    typeof value.root !== "string" ||
    typeof value.staging !== "string" ||
    typeof value.rollback !== "string" ||
    typeof value.phase !== "string" ||
    !phases.includes(value.phase as DataRootSwapPhase)
  ) {
    throw new AppError("INTERNAL", "DATA_ROOT restore marker is malformed");
  }
  return {
    version: 1,
    root: value.root,
    staging: value.staging,
    rollback: value.rollback,
    phase: value.phase as DataRootSwapPhase,
  };
}

export async function clearDataRootSwapMarker(root = getDataRoot()): Promise<void> {
  await rm(getSwapMarkerPath(root), { force: true });
}

/** Preconditions for the two rename boundaries of a canonical root swap. */
export async function validateDataRootSwapPrerequisites(root = getDataRoot()): Promise<void> {
  const resolvedRoot = resolve(root);
  if (resolvedRoot === dirname(resolvedRoot)) {
    throw new AppError("CONFIG_INVALID", "DATA_ROOT cannot be the filesystem root for a restore");
  }
  let rootInfo;
  try {
    rootInfo = await lstat(resolvedRoot);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new AppError("CONFIG_INVALID", `DATA_ROOT ${resolvedRoot} must exist before a restore`);
    }
    throw err;
  }
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new AppError("CONFIG_INVALID", `DATA_ROOT ${resolvedRoot} must be a non-symlink directory`);
  }
  const parentInfo = await stat(dirname(resolvedRoot));
  if (!parentInfo.isDirectory()) {
    throw new AppError("CONFIG_INVALID", `DATA_ROOT parent ${dirname(resolvedRoot)} is not a directory`);
  }
  if (rootInfo.dev !== parentInfo.dev) {
    throw new AppError("CONFIG_INVALID", "DATA_ROOT and its parent must be on the same filesystem");
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

function validateMarkerPaths(marker: DataRootSwapMarker, root: string): void {
  if (
    marker.root !== root ||
    marker.rollback !== getRollbackRoot(root) ||
    marker.staging === root ||
    marker.staging === marker.rollback ||
    dirname(marker.staging) !== dirname(root)
  ) {
    throw new AppError("INTERNAL", "DATA_ROOT restore marker does not describe this DATA_ROOT");
  }
}

/**
 * Restore the last known-good root before ensureDataRoot can create anything.
 * A rollback without a matching marker is intentionally never removed or
 * adopted: it is unclassified operator data and must be preserved.
 */
export async function recoverDataRootWhileLocked(): Promise<boolean> {
  const root = getDataRoot();
  const rollback = getRollbackRoot(root);
  const marker = await readDataRootSwapMarker(root);
  const rootExists = await pathExists(root);
  const rollbackExists = await pathExists(rollback);

  if (!marker) {
    if (!rootExists && rollbackExists) {
      throw new AppError(
        "INTERNAL",
        `DATA_ROOT is absent but ${rollback} has no matching restore marker; refusing to modify the rollback`,
      );
    }
    return false;
  }
  validateMarkerPaths(marker, root);

  const restoreOldRoot = async (): Promise<boolean> => {
    if (!rollbackExists && !(await pathExists(rollback))) {
      throw new AppError("INTERNAL", "Interrupted restore has no classified rollback root to recover");
    }
    const currentlyAtRoot = await pathExists(root);
    let quarantine: string | undefined;
    if (currentlyAtRoot) {
      // The marker classifies this root as part of the interrupted swap before
      // it is quarantined. Never remove an unexpected root based on a name.
      quarantine = `${root}.unexpected-${randomUUID()}`;
      await rename(root, quarantine);
    }
    try {
      await rename(rollback, root);
    } catch (err) {
      if (quarantine) await rename(quarantine, root).catch(() => undefined);
      throw err;
    }
    if (quarantine) await rm(quarantine, { recursive: true, force: true });
    await writeDataRootSwapMarker({ ...marker, phase: "rolled-back" });
    logger.warn("Recovered DATA_ROOT from an interrupted restore", { root, phase: marker.phase });
    await import("@/lib/audit/log")
      .then(({ audit }) =>
        audit({
          type: "backup.restore.recovered",
          actorAccountId: null,
          clientAddress: null,
          detail: { recoveredFromPhase: marker.phase },
        }),
      )
      .catch(() => undefined);
    return true;
  };

  switch (marker.phase) {
    case "prepared":
      // A crash between the first rename and its durable phase update leaves
      // the marker at prepared and the classified old root at .rollback.
      if (!rootExists && rollbackExists) return restoreOldRoot();
      if (!rootExists && !rollbackExists) {
        throw new AppError("INTERNAL", "Interrupted restore left DATA_ROOT absent without a rollback root");
      }
      if (rootExists && rollbackExists) return restoreOldRoot();
      return false;
    case "old-root-moved":
    case "stage-installed":
      if (rollbackExists) return restoreOldRoot();
      throw new AppError("INTERNAL", "Interrupted restore marker has no rollback root to recover");
    case "verified":
      if (!rootExists && rollbackExists) return restoreOldRoot();
      if (!rootExists) throw new AppError("INTERNAL", "Verified restore has no DATA_ROOT");
      if (rollbackExists) await rm(rollback, { recursive: true, force: true });
      await clearDataRootSwapMarker(root);
      return false;
    case "rolled-back":
      if (!rootExists && rollbackExists) return restoreOldRoot();
      if (!rootExists) throw new AppError("INTERNAL", "Rolled-back restore has no DATA_ROOT");
      // Keep the marker as an incident record; a subsequent activation may
      // replace it only after it has revalidated the root and rollback paths.
      return false;
  }
}

export async function recoverDataRoot(): Promise<boolean> {
  const { withLock } = await import("./lock");
  return withLock("writes", () => withLock("root-swap", recoverDataRootWhileLocked));
}

/**
 * Complete the only unsafe point of a root swap: if the process died after
 * moving the old root aside but before installing the staged root, put the
 * old root back before startup creates a fresh DATA_ROOT.
 */
/**
 * Verify DATA_ROOT exists and is writable, creating the canonical layout.
 * Called at startup; throws a clear error when misconfigured.
 */
async function ensureDataRootWhileLocked(): Promise<void> {
  const root = getDataRoot();
  try {
    await mkdir(root, { recursive: true });
  } catch (err) {
    throw new AppError("CONFIG_INVALID", `DATA_ROOT ${root} cannot be created: ${(err as Error).message}`);
  }
  try {
    await access(root, constants.R_OK | constants.W_OK);
  } catch {
    throw new AppError(
      "CONFIG_INVALID",
      `DATA_ROOT ${root} is not readable/writable. Fix ownership/permissions for the application user.`,
    );
  }
  const info = await stat(root);
  if (!info.isDirectory()) {
    throw new AppError("CONFIG_INVALID", `DATA_ROOT ${root} exists but is not a directory`);
  }
  for (const dir of DATA_DIRS) {
    await mkdir(join(root, dir), { recursive: true });
  }
  // Writability probe (catches read-only mounts that pass access(2)).
  const probe = join(root, "tmp", `.probe-${process.pid}`);
  try {
    await writeFile(probe, "ok", { flag: "wx" });
    await rm(probe, { force: true });
  } catch (err) {
    throw new AppError("CONFIG_INVALID", `DATA_ROOT ${root} failed a write probe: ${(err as Error).message}`);
  }
}

export async function ensureDataRoot(): Promise<void> {
  const { withLock } = await import("./lock");
  await withLock("writes", () =>
    withLock("root-swap", async () => {
      await recoverDataRootWhileLocked();
      await ensureDataRootWhileLocked();
    }),
  );
}

/**
 * Abandoned staged-media uploads (scratch .webp + sidecar pairs in
 * tmp/staged-media) are swept after this TTL. They are never canonical data —
 * they only exist between staging and recipe creation.
 */
const STAGED_MEDIA_TTL_MS = 24 * 60 * 60 * 1000;

/** Remove orphaned atomic-write temp files left behind by interrupted writes. */
export async function cleanupOrphanedTmpFiles(): Promise<number> {
  const root = getDataRoot();
  let removed = 0;
  async function sweep(dir: string, depth: number): Promise<void> {
    if (depth > 4) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await sweep(full, depth + 1);
      } else if (entry.name.includes(".tmp-") || entry.name.endsWith(".tmp")) {
        try {
          await rm(full, { force: true });
          removed += 1;
        } catch {
          // best effort
        }
      }
    }
  }
  await sweep(root, 0);

  // Sweep abandoned staged-media uploads (crashes/cancellations) older than the
  // TTL, then drop the now-empty directory.
  const stagedDir = join(root, "tmp", "staged-media");
  const cutoff = Date.now() - STAGED_MEDIA_TTL_MS;
  try {
    const entries = await readdir(stagedDir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(stagedDir, entry.name);
      if (!entry.isFile()) continue;
      try {
        const info = await stat(full);
        if (info.mtimeMs < cutoff) {
          await rm(full, { force: true });
          removed += 1;
        }
      } catch {
        // best effort — the file may have vanished concurrently
      }
    }
    try {
      const remaining = await readdir(stagedDir);
      if (remaining.length === 0) await rm(stagedDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  } catch {
    // staged-media directory absent — nothing to sweep
  }

  if (removed > 0) logger.info("Removed orphaned temp files from interrupted writes", { removed });
  return removed;
}
