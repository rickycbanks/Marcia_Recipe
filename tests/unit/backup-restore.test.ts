import { createWriteStream } from "node:fs";
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip, gzipSync } from "node:zlib";
import * as tar from "tar-stream";
import { afterEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { createBackup } from "@/lib/backups/service";
import { restoreBackup } from "@/lib/backups/restore";
import { writeJsonAtomic } from "@/lib/storage/atomic";
import {
  ensureDataRoot,
  getDataRoot,
  getRollbackRoot,
  getSwapMarkerPath,
  writeDataRootSwapMarker,
} from "@/lib/storage/dataRoot";
import { getSearchIndex } from "@/lib/storage/indexes";
import { accountSchema, recipeSchema, siteConfigSchema } from "@/lib/validation/schemas";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const RECIPE_ID = "00000000-0000-4000-8000-000000000002";
const STEP_ID = "00000000-0000-4000-8000-000000000003";
const NOW = "2026-01-01T00:00:00.000Z";

let root: string | undefined;
let archiveDirectory: string | undefined;

function owner(sessionVersion = 7) {
  return {
    schemaVersion: 1 as const,
    id: OWNER_ID,
    username: "owner",
    displayName: "Owner",
    password: { algo: "scrypt" as const, N: 16_384, r: 8, p: 1, salt: "salt", hash: "hash" },
    type: "owner" as const,
    capabilities: [],
    sessionVersion,
    disabledAt: null,
    createdViaInvitationId: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function site(siteName = "Original") {
  return {
    schemaVersion: 1 as const,
    siteName,
    defaultVisibility: "public" as const,
    theme: "editorial" as const,
    setupCompletedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function recipeV2(slug = "tomato-pasta") {
  return {
    schemaVersion: 2 as const,
    id: RECIPE_ID,
    slug,
    previousSlugs: [],
    visibility: "public" as const,
    title: "Tomato Pasta",
    description: "A simple recipe",
    prepMinutes: 5,
    cookMinutes: 10,
    servings: 2,
    difficulty: "easy" as const,
    category: "Dinner",
    tags: ["quick"],
    sourceUrl: null,
    bookTitle: null,
    bookAuthor: null,
    bookPage: null,
    ingredients: [],
    steps: [{ id: STEP_ID, order: 0, text: "Cook it." }],
    notesMarkdown: "",
    media: [],
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

async function writeCompleteData(options: { siteName?: string; sessionVersion?: number; recipe?: unknown } = {}) {
  await ensureDataRoot();
  await writeJsonAtomic(join(getDataRoot(), "config", "site.json"), site(options.siteName));
  await writeJsonAtomic(join(getDataRoot(), "accounts", `${OWNER_ID}.json`), owner(options.sessionVersion));
  if (options.recipe !== undefined) {
    await writeJsonAtomic(join(getDataRoot(), "recipes", RECIPE_ID, "recipe.json"), options.recipe);
  } else {
    await writeJsonAtomic(join(getDataRoot(), "recipes", RECIPE_ID, "recipe.json"), recipeV2());
  }
}

async function makeArchive(entries: Record<string, string | Buffer>): Promise<string> {
  if (!archiveDirectory) archiveDirectory = await mkdtemp(join(tmpdir(), "marcia-restore-archive-"));
  const archivePath = join(archiveDirectory, `archive-${Date.now()}-${Math.random()}.tar.gz`);
  const pack = tar.pack();
  const done = pipeline(pack, createGzip(), createWriteStream(archivePath));
  for (const [name, body] of Object.entries(entries)) {
    await new Promise<void>((resolveEntry, rejectEntry) => {
      pack.entry({ name, size: Buffer.byteLength(body) }, body, (error) =>
        error ? rejectEntry(error) : resolveEntry(),
      );
    });
  }
  pack.finalize();
  await done;
  return archivePath;
}

function manifest(fileCount: number) {
  return JSON.stringify({ formatVersion: 1, createdAt: NOW, fileCount });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface AuditLine {
  at: string;
  type: string;
  actorAccountId: string | null;
  clientAddress: string | null;
  detail: Record<string, unknown>;
}

/** Read the current monthly audit log under DATA_ROOT (empty when absent). */
async function readAuditEvents(): Promise<AuditLine[]> {
  const fileName = `audit-${new Date().toISOString().slice(0, 7).replace("-", "")}.jsonl`;
  try {
    const raw = await readFile(join(getDataRoot(), "audit", fileName), "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as AuditLine);
  } catch {
    return [];
  }
}

/** Build a raw ustar header (valid checksum) declaring an arbitrary member size. */
function tarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0\0", 100, 8, "utf8");
  header.write("0000000\0\0", 108, 8, "utf8");
  header.write("0000000\0\0", 116, 8, "utf8");
  header.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "utf8");
  header.write("00000000000\0", 136, 12, "utf8");
  header[156] = 0x30; // regular file typeflag
  header.write("ustar\0", 257, 6, "utf8");
  header.write("00", 263, 2, "utf8");
  let sum = 8 * 32;
  for (let i = 0; i < 512; i++) {
    if (i >= 148 && i < 156) continue;
    sum += header.readUInt8(i);
  }
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf8");
  return header;
}

/** Write a gzip file that decompresses to `totalBytes` of zeros (max compression ratio). */
async function writeBloatArchive(path: string, totalBytes: number): Promise<void> {
  const gzip = createGzip();
  const done = pipeline(gzip, createWriteStream(path));
  const chunk = Buffer.alloc(1024 * 1024, 0);
  for (let written = 0; written < totalBytes; written += chunk.length) {
    gzip.write(chunk);
  }
  gzip.end();
  await done;
}

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    await rm(`${root}.locks`, { recursive: true, force: true });
    await rm(getRollbackRoot(root), { recursive: true, force: true });
    await rm(getSwapMarkerPath(root), { force: true });
    // extractArchive removes its staging sibling on error; clean any leftovers.
    // Scope the sweep to this pid so a parallel test fork (which also prefixes
    // staging siblings with `.marcia-restore-${process.pid}-`) cannot have its
    // mid-flight staging dir yanked out from under it.
    try {
      const prefix = `.marcia-restore-${process.pid}-`;
      for (const entry of await readdir(join(root, ".."))) {
        if (entry.startsWith(prefix)) {
          await rm(join(root, "..", entry), { recursive: true, force: true });
        }
      }
    } catch {
      // parent dir listing unavailable — nothing to clean
    }
  }
  if (archiveDirectory) await rm(archiveDirectory, { recursive: true, force: true });
  delete process.env.DATA_ROOT;
  resetEnvCache();
  root = undefined;
  archiveDirectory = undefined;
});

describe("staged backup restore", () => {
  it("activates a valid staged restore, writes a safety snapshot, and rotates sessions", async () => {
    root = await mkdtemp(join(tmpdir(), "marcia-restore-root-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await writeCompleteData();
    const sourceBackup = await createBackup(null);

    await writeJsonAtomic(join(getDataRoot(), "config", "site.json"), site("Changed live data"));
    const report = await restoreBackup(join(getDataRoot(), "backups", sourceBackup.fileName), { force: true });

    expect(report.restored).toBe(true);
    expect(report.safetyBackup?.fileName).toMatch(/^marcia-backup-/);
    expect(siteConfigSchema.parse(JSON.parse(await readFile(join(getDataRoot(), "config", "site.json"), "utf8"))).siteName).toBe(
      "Original",
    );
    expect(accountSchema.parse(JSON.parse(await readFile(join(getDataRoot(), "accounts", `${OWNER_ID}.json`), "utf8"))).sessionVersion).toBe(
      8,
    );
    expect(recipeSchema.parse(JSON.parse(await readFile(join(getDataRoot(), "recipes", RECIPE_ID, "recipe.json"), "utf8"))).slug).toBe(
      "tomato-pasta",
    );
    expect((await readdir(join(getDataRoot(), "backups"))).length).toBeGreaterThanOrEqual(2);
  });

  it("never mutates live data for an invalid non-dry-run archive", async () => {
    root = await mkdtemp(join(tmpdir(), "marcia-restore-root-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await writeCompleteData({ siteName: "Keep this" });
    const archive = await makeArchive({
      "manifest.json": manifest(1),
      "config/site.json": JSON.stringify(site()),
    });

    await expect(restoreBackup(archive, { force: true })).rejects.toThrow(/validation failed/);
    expect(siteConfigSchema.parse(JSON.parse(await readFile(join(getDataRoot(), "config", "site.json"), "utf8"))).siteName).toBe(
      "Keep this",
    );
    await expect(readFile(getRollbackRoot())).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports missing required dataset members during dry-run", async () => {
    root = await mkdtemp(join(tmpdir(), "marcia-restore-root-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await ensureDataRoot();
    const archive = await makeArchive({ "manifest.json": manifest(0) });

    const report = await restoreBackup(archive, { dryRun: true });
    expect(report.restored).toBe(false);
    expect(report.problems.join(" ")).toMatch(/site config|enabled owner/);
  });

  it("migrates a recipe v1 document before validation and activation", async () => {
    root = await mkdtemp(join(tmpdir(), "marcia-restore-root-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await writeCompleteData({ recipe: recipeV2("legacy") });
    const legacy = { ...recipeV2("legacy"), schemaVersion: 1 as const };
    delete (legacy as { bookTitle?: unknown }).bookTitle;
    delete (legacy as { bookAuthor?: unknown }).bookAuthor;
    delete (legacy as { bookPage?: unknown }).bookPage;
    const archive = await makeArchive({
      "manifest.json": manifest(3),
      "config/site.json": JSON.stringify(site("Legacy")),
      [`accounts/${OWNER_ID}.json`]: JSON.stringify(owner()),
      [`recipes/${RECIPE_ID}/recipe.json`]: JSON.stringify(legacy),
    });

    const report = await restoreBackup(archive, { force: true });
    expect(report.restored).toBe(true);
    const restored = recipeSchema.parse(
      JSON.parse(await readFile(join(getDataRoot(), "recipes", RECIPE_ID, "recipe.json"), "utf8")),
    );
    expect(restored.schemaVersion).toBe(2);
    expect(restored.bookTitle).toBeNull();
  });

  it("recovers a rollback sibling before creating a fresh root", async () => {
    root = await mkdtemp(join(tmpdir(), "marcia-restore-root-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await writeFile(join(root, "recovery-marker"), "old root");
    const rollback = getRollbackRoot(root);
    await rename(root, rollback);
    await writeDataRootSwapMarker({ version: 1, root, staging: `${root}.staging`, rollback, phase: "old-root-moved" });

    await ensureDataRoot();
    expect(await readFile(join(root, "recovery-marker"), "utf8")).toBe("old root");
    await expect(readFile(rollback)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recovers the old root after the old-root-moved failpoint", async () => {
    root = await mkdtemp(join(tmpdir(), "marcia-restore-root-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await writeCompleteData({ siteName: "Keep this" });
    const sourceBackup = await createBackup(null);

    await expect(
      restoreBackup(join(getDataRoot(), "backups", sourceBackup.fileName), {
        force: true,
        failpoint: (point) => {
          if (point === "after-root-to-rollback") throw new Error("fail after old root moved");
        },
      }),
    ).rejects.toThrow("fail after old root moved");

    await ensureDataRoot();
    expect(siteConfigSchema.parse(JSON.parse(await readFile(join(getDataRoot(), "config", "site.json"), "utf8"))).siteName).toBe(
      "Keep this",
    );
  });

  it("recovers the old root after the stage-installed failpoint", async () => {
    root = await mkdtemp(join(tmpdir(), "marcia-restore-root-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await writeCompleteData({ siteName: "Keep this" });
    const sourceBackup = await createBackup(null);

    await expect(
      restoreBackup(join(getDataRoot(), "backups", sourceBackup.fileName), {
        force: true,
        failpoint: (point) => {
          if (point === "after-stage-to-root") throw new Error("fail after stage installed");
        },
      }),
    ).rejects.toThrow("fail after stage installed");

    await ensureDataRoot();
    expect(siteConfigSchema.parse(JSON.parse(await readFile(join(getDataRoot(), "config", "site.json"), "utf8"))).siteName).toBe(
      "Keep this",
    );
  });
});

describe("backup restore barriers, limits, and audit", () => {
  it("rejects an archive member whose declared size exceeds the entry cap", async () => {
    root = await mkdtemp(join(tmpdir(), "marcia-lim-root-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await writeCompleteData({ siteName: "Keep this" });

    const archivePath = join(root, "oversized.tar.gz");
    const oversized = Buffer.concat([
      tarHeader("config/huge.json", 64 * 1024 * 1024 + 1),
      Buffer.alloc(512),
      Buffer.alloc(1024), // end of archive
    ]);
    await writeFile(archivePath, gzipSync(oversized));

    await expect(restoreBackup(archivePath, { force: true })).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
    });
    // Rejected before any swap: no marker, no rollback sibling, live data intact.
    await expect(readFile(getSwapMarkerPath(root))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(getRollbackRoot(root))).rejects.toMatchObject({ code: "ENOENT" });
    expect(siteConfigSchema.parse(JSON.parse(await readFile(join(getDataRoot(), "config", "site.json"), "utf8"))).siteName).toBe(
      "Keep this",
    );
  });

  it("rejects an archive whose decompressed total exceeds the budget", async () => {
    root = await mkdtemp(join(tmpdir(), "marcia-bloat-root-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await writeCompleteData({ siteName: "Keep this" });

    const archivePath = join(root, "bloat.tar.gz");
    // The decompressed-size budget is 512 MiB; this tiny gzip expands past it
    // because all-zero data compresses at the maximum ratio.
    await writeBloatArchive(archivePath, 512 * 1024 * 1024 + 1024);

    await expect(restoreBackup(archivePath, { force: true })).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
    });
    await expect(readFile(getSwapMarkerPath(root))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(getRollbackRoot(root))).rejects.toMatchObject({ code: "ENOENT" });
    expect(siteConfigSchema.parse(JSON.parse(await readFile(join(getDataRoot(), "config", "site.json"), "utf8"))).siteName).toBe(
      "Keep this",
    );
  });

  it("leaves live data intact when activation fails before moving the old root", async () => {
    root = await mkdtemp(join(tmpdir(), "marcia-before-move-root-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await writeCompleteData({ siteName: "Keep this" });
    const sourceBackup = await createBackup(null);

    await expect(
      restoreBackup(join(getDataRoot(), "backups", sourceBackup.fileName), {
        force: true,
        failpoint: (point) => {
          if (point === "before-root-to-rollback") throw new Error("fail before old root moved");
        },
      }),
    ).rejects.toThrow("fail before old root moved");

    await ensureDataRoot();
    expect(siteConfigSchema.parse(JSON.parse(await readFile(join(getDataRoot(), "config", "site.json"), "utf8"))).siteName).toBe(
      "Keep this",
    );
    await expect(readFile(getRollbackRoot(root))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recovers live data when activation fails before installing the staged root", async () => {
    root = await mkdtemp(join(tmpdir(), "marcia-before-install-root-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await writeCompleteData({ siteName: "Keep this" });
    const sourceBackup = await createBackup(null);

    await expect(
      restoreBackup(join(getDataRoot(), "backups", sourceBackup.fileName), {
        force: true,
        failpoint: (point) => {
          if (point === "before-stage-to-root") throw new Error("fail before stage installed");
        },
      }),
    ).rejects.toThrow("fail before stage installed");

    await ensureDataRoot();
    expect(siteConfigSchema.parse(JSON.parse(await readFile(join(getDataRoot(), "config", "site.json"), "utf8"))).siteName).toBe(
      "Keep this",
    );
    await expect(readFile(getRollbackRoot(root))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("clears a verified marker and removes a leftover rollback root", async () => {
    root = await mkdtemp(join(tmpdir(), "marcia-verified-root-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await writeCompleteData({ siteName: "Keep this" });

    const rollback = getRollbackRoot(root);
    await mkdir(join(rollback, "config"), { recursive: true });
    await writeFile(join(rollback, "config", "site.json"), JSON.stringify(site("Stale rollback")));
    await writeDataRootSwapMarker({ version: 1, root, staging: `${root}.staging`, rollback, phase: "verified" });

    await ensureDataRoot();
    await expect(readFile(rollback)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(getSwapMarkerPath(root))).rejects.toMatchObject({ code: "ENOENT" });
    expect(siteConfigSchema.parse(JSON.parse(await readFile(join(getDataRoot(), "config", "site.json"), "utf8"))).siteName).toBe(
      "Keep this",
    );
  });

  it("blocks readiness behind the root-swap barrier mid-restore", async () => {
    root = await mkdtemp(join(tmpdir(), "marcia-barrier-root-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await writeCompleteData();
    const sourceBackup = await createBackup(null);
    await writeJsonAtomic(join(getDataRoot(), "config", "site.json"), site("Changed live data"));

    const restorePromise = restoreBackup(join(getDataRoot(), "backups", sourceBackup.fileName), {
      force: true,
      failpoint: async (point) => {
        if (point === "after-root-to-rollback") await sleep(700);
      },
    });

    // Wait until the swap has moved the old root aside — the barrier window.
    const rollbackPath = getRollbackRoot(root);
    const deadline = Date.now() + 5000;
    for (;;) {
      try {
        await access(rollbackPath);
        break;
      } catch {
        if (Date.now() > deadline) throw new Error("restore never entered the root-swap window");
        await sleep(25);
      }
    }
    // Mid-window DATA_ROOT is absent: a naive readiness check would create a fresh root.
    await expect(readFile(join(root, "config", "site.json"))).rejects.toMatchObject({ code: "ENOENT" });

    // Readiness must block on the held root-swap barrier, not create a fresh root.
    const ensurePromise = ensureDataRoot();
    const indexPromise = getSearchIndex();
    const report = await restorePromise;
    await Promise.all([ensurePromise, indexPromise]);
    const index = await indexPromise;

    expect(report.restored).toBe(true);
    // DATA_ROOT holds the RESTORED dataset, not a fresh empty root or the old data.
    expect(siteConfigSchema.parse(JSON.parse(await readFile(join(getDataRoot(), "config", "site.json"), "utf8"))).siteName).toBe(
      "Original",
    );
    expect(index.slugToId["tomato-pasta"]).toBe(RECIPE_ID);
    await expect(readFile(rollbackPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(getSwapMarkerPath(root))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("migrates a v0 recipe through v1 to v2 and emits one migration.applied audit event", async () => {
    root = await mkdtemp(join(tmpdir(), "marcia-v0-root-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await ensureDataRoot();
    const v0 = {
      id: RECIPE_ID,
      name: "Legacy Pasta",
      slug: "legacy-pasta",
      previousSlugs: [],
      visibility: "public",
      instructions: ["Cook the pasta."],
      tags: [],
      createdAt: NOW,
      updatedAt: NOW,
    };
    const archive = await makeArchive({
      "manifest.json": manifest(3),
      "config/site.json": JSON.stringify(site("V0")),
      [`accounts/${OWNER_ID}.json`]: JSON.stringify(owner()),
      [`recipes/${RECIPE_ID}/recipe.json`]: JSON.stringify(v0),
    });

    const report = await restoreBackup(archive, { force: true });
    expect(report.restored).toBe(true);
    const restored = recipeSchema.parse(
      JSON.parse(await readFile(join(getDataRoot(), "recipes", RECIPE_ID, "recipe.json"), "utf8")),
    );
    expect(restored.schemaVersion).toBe(2);
    expect(restored.title).toBe("Legacy Pasta");
    expect(restored.bookTitle).toBeNull();

    const migrated = (await readAuditEvents()).filter((event) => event.type === "migration.applied");
    expect(migrated).toHaveLength(1);
    expect(migrated[0]!.detail.migratedDocuments as number).toBeGreaterThanOrEqual(1);
    expect(migrated[0]!.detail.surface).toBe("restore");
  });

  it("rotates staged sessions to max(live, staged) + 1 when the stage is older", async () => {
    root = await mkdtemp(join(tmpdir(), "marcia-session-root-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await writeCompleteData({ sessionVersion: 10 });
    const archive = await makeArchive({
      "manifest.json": manifest(3),
      "config/site.json": JSON.stringify(site("New")),
      [`accounts/${OWNER_ID}.json`]: JSON.stringify(owner(3)),
      [`recipes/${RECIPE_ID}/recipe.json`]: JSON.stringify(recipeV2()),
    });

    await restoreBackup(archive, { force: true });
    const account = accountSchema.parse(
      JSON.parse(await readFile(join(getDataRoot(), "accounts", `${OWNER_ID}.json`), "utf8")),
    );
    expect(account.sessionVersion).toBe(11);
  });

  it("emits a backup.restore.recovered audit event after a real recovery", async () => {
    root = await mkdtemp(join(tmpdir(), "marcia-recover-audit-root-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await writeFile(join(root, "recovery-marker"), "old root");
    const rollback = getRollbackRoot(root);
    await rename(root, rollback);
    await writeDataRootSwapMarker({ version: 1, root, staging: `${root}.staging`, rollback, phase: "old-root-moved" });

    await ensureDataRoot();
    const recovered = (await readAuditEvents()).filter((event) => event.type === "backup.restore.recovered");
    expect(recovered).toHaveLength(1);
    expect(recovered[0]!.detail.recoveredFromPhase).toBe("old-root-moved");
    expect(recovered[0]!.actorAccountId).toBeNull();
  });

  it("emits exactly one backup.restore.failed with rolledBack true after an activation failure", async () => {
    root = await mkdtemp(join(tmpdir(), "marcia-fail-audit-root-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await writeCompleteData({ siteName: "Keep this" });
    const sourceBackup = await createBackup(null);

    await expect(
      restoreBackup(join(getDataRoot(), "backups", sourceBackup.fileName), {
        force: true,
        failpoint: (point) => {
          if (point === "after-root-to-rollback") throw new Error("fail after old root moved");
        },
      }),
    ).rejects.toThrow("fail after old root moved");

    const failed = (await readAuditEvents()).filter((event) => event.type === "backup.restore.failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.detail.rolledBack).toBe(true);
    expect(failed[0]!.detail.reason).toBe("fail after old root moved");
  });
});
