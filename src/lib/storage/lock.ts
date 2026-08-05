import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { AppError } from "@/lib/errors";
import { getDataRoot } from "./dataRoot";

export type LockName = "writes" | "backup" | "root-swap";

const heldLocks = new AsyncLocalStorage<ReadonlySet<LockName>>();

const LOCK_OPTIONS: lockfile.LockOptions = {
  // A crashed holder releases automatically after the stale window (the lock
  // mtime is refreshed while held, so active holders are never considered stale).
  stale: 30_000,
  update: 5_000,
  retries: { retries: 20, minTimeout: 50, maxTimeout: 1_000, randomize: true },
  realpath: false,
};

async function lockTarget(name: LockName): Promise<string> {
  const target = join(getLockRoot(), `${name}.lockfile`);
  await mkdir(getLockRoot(), { recursive: true });
  // proper-lockfile locks an existing path by creating a sibling "<path>.lock" dir.
  await writeFile(target, "", { flag: "a" });
  return target;
}

/** Stable sibling used for locks so a DATA_ROOT rename cannot strand a lock. */
export function getLockRoot(): string {
  return `${getDataRoot()}.locks`;
}

/**
 * Run `fn` while holding the named cross-process lock. All mutations of
 * canonical data go through the single "writes" lock: with one writable
 * instance and low traffic this is the simplest deadlock-free design, and
 * backups can block all writes briefly to guarantee a consistent snapshot.
 */
export async function withLock<T>(name: LockName, fn: () => Promise<T>): Promise<T> {
  const currentLocks = heldLocks.getStore();
  if (currentLocks?.has(name)) return fn();

  const target = await lockTarget(name);
  let release: (() => Promise<void>) | null = null;
  try {
    release = await lockfile.lock(target, LOCK_OPTIONS);
  } catch (err) {
    throw new AppError("CONFLICT", `Could not acquire ${name} lock: ${(err as Error).message}`);
  }
  try {
    const nextLocks = new Set(currentLocks ?? []);
    nextLocks.add(name);
    return await heldLocks.run(nextLocks, fn);
  } finally {
    await release().catch(() => undefined);
  }
}

/** Convenience wrapper for the global mutation lock. */
export const withWriteLock = <T>(fn: () => Promise<T>): Promise<T> => withLock("writes", fn);
