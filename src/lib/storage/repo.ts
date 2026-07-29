import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ZodType } from "zod";
import { readJson } from "./atomic";
import { quarantineFile } from "./quarantine";

/** List `<id>.json` documents in a directory, validating each against the schema.
 * Malformed files are quarantined and skipped (the app stays up; owner is alerted). */
export async function listDocuments<T>(dir: string, schema: ZodType<T>): Promise<T[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const docs: T[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    if (entry.name.includes(".corrupt-") || entry.name.includes(".tmp-")) continue;
    const doc = await readJson(join(dir, entry.name), schema, { quarantine: quarantineFile });
    if (doc !== null) docs.push(doc);
  }
  return docs;
}

/** List recipe subdirectories (each holds a recipe.json + media/). */
export async function listSubdirectories(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}
