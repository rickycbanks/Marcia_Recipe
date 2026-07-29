import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { ensureDataRoot } from "@/lib/storage/dataRoot";
import { readJson, writeJsonAtomic } from "@/lib/storage/atomic";
import { resolveWithinDataRoot } from "@/lib/storage/paths";
import { z } from "zod";

const testSchema = z.object({ value: z.string() });
let root: string | undefined;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  delete process.env.DATA_ROOT;
  resetEnvCache();
  root = undefined;
});

describe("flat-file storage", () => {
  it("writes atomically, reads validated documents, and creates the layout", async () => {
    root = await mkdtemp(join(tmpdir(), "marcia-recipe-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await ensureDataRoot();

    const path = resolveWithinDataRoot("config", "test.json");
    await writeJsonAtomic(path, { value: "ok" });
    await expect(readJson(path, testSchema)).resolves.toEqual({ value: "ok" });
    expect(resolveWithinDataRoot("config", "test.json")).toBe(path);
    expect(() => resolveWithinDataRoot("..", "outside.json")).toThrow();
  });
});
