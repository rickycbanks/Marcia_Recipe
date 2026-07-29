import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { ZodType } from "zod";
import { AppError, storageCorrupt } from "@/lib/errors";

/**
 * Atomic JSON persistence: serialize to a temp file in the SAME directory,
 * fsync it, then rename over the target (atomic on POSIX filesystems).
 * A crash either leaves the old file or the new file — never a torn write.
 */
export async function writeJsonAtomic(absPath: string, value: unknown): Promise<void> {
  await writeBufferAtomic(absPath, Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8"));
}

/** Atomic binary persistence for media and other non-JSON canonical files. */
export async function writeBufferAtomic(absPath: string, buffer: Uint8Array): Promise<void> {
  await mkdir(dirname(absPath), { recursive: true });
  const tmpPath = `${absPath}.tmp-${randomUUID()}`;
  let handle;
  try {
    handle = await open(tmpPath, "w");
    await handle.writeFile(buffer);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(tmpPath, absPath);
  } catch (err) {
    if (handle) await handle.close().catch(() => undefined);
    await rm(tmpPath, { force: true }).catch(() => undefined);
    throw new AppError("INTERNAL", `Failed to write ${absPath}: ${(err as Error).message}`);
  }
}

export class QuarantinedError extends Error {
  constructor(
    message: string,
    readonly originalPath: string,
    readonly quarantinePath: string | null,
  ) {
    super(message);
    this.name = "QuarantinedError";
  }
}

export interface ReadJsonOptions {
  /** Move malformed documents aside instead of throwing, and return null. */
  quarantine?: (absPath: string, reason: string) => Promise<string | null>;
}

/**
 * Read + parse + schema-validate a JSON document. Returns null when the file
 * does not exist. Malformed content throws QuarantinedError (or quarantines
 * and returns null when a quarantine handler is supplied).
 */
export async function readJson<T>(
  absPath: string,
  schema: ZodType<T>,
  options: ReadJsonOptions = {},
): Promise<T | null> {
  let raw: string;
  try {
    raw = await readFile(absPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return handleMalformed(absPath, `invalid JSON: ${(err as Error).message}`, options);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const reason = result.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return handleMalformed(absPath, `schema validation failed: ${reason}`, options);
  }
  return result.data;
}

async function handleMalformed<T>(
  absPath: string,
  reason: string,
  options: ReadJsonOptions,
): Promise<T | null> {
  if (options.quarantine) {
    await options.quarantine(absPath, reason);
    return null;
  }
  throw storageCorrupt(`Malformed document at ${absPath}: ${reason}`);
}
