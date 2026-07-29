import { constants } from "node:fs";
import { access, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
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

/**
 * Verify DATA_ROOT exists and is writable, creating the canonical layout.
 * Called at startup; throws a clear error when misconfigured.
 */
export async function ensureDataRoot(): Promise<void> {
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
  if (removed > 0) logger.info("Removed orphaned temp files from interrupted writes", { removed });
  return removed;
}
