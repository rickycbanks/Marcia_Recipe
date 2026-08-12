import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { restoreDemoSeed, validateSeedDir } from "../../scripts/restore-demo-seed";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const BURGER_RECIPE_ID = "00000000-0000-4000-8000-000000000010";
const PANCAKES_RECIPE_ID = "00000000-0000-4000-8000-000000000020";
const STEP_ID = "00000000-0000-4000-8000-000000000099";
const NOW = "2026-01-01T00:00:00.000Z";
const SECONDARY_MEDIA_ID = "00000000-0000-4000-8000-00000000b001";
const PRIMARY_MEDIA_ID = "00000000-0000-4000-8000-00000000b002";

let seedDir: string | undefined;
let root: string | undefined;

function owner() {
  return {
    schemaVersion: 1 as const,
    id: OWNER_ID,
    username: "owner",
    displayName: "Owner",
    password: { algo: "scrypt" as const, N: 16_384, r: 8, p: 1, salt: "salt", hash: "hash" },
    type: "owner" as const,
    capabilities: [],
    sessionVersion: 1,
    disabledAt: null,
    createdViaInvitationId: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function site() {
  return {
    schemaVersion: 1 as const,
    siteName: "Demo",
    defaultVisibility: "public" as const,
    theme: "editorial" as const,
    setupCompletedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

interface MediaOpts {
  id: string;
  isPrimary: boolean;
  bytes: number;
  alt?: string;
}
function mediaItem(opts: MediaOpts) {
  return {
    id: opts.id,
    fileName: `${opts.id}.webp`,
    alt: opts.alt ?? "test image",
    width: 100,
    height: 100,
    bytes: opts.bytes,
    isPrimary: opts.isPrimary,
    createdAt: NOW,
  };
}

interface RecipeOpts {
  id: string;
  slug: string;
  title: string;
  media: ReturnType<typeof mediaItem>[];
}
function recipe(opts: RecipeOpts) {
  return {
    schemaVersion: 2 as const,
    id: opts.id,
    slug: opts.slug,
    previousSlugs: [],
    visibility: "public" as const,
    title: opts.title,
    description: "",
    prepMinutes: 5,
    cookMinutes: 10,
    servings: 2,
    difficulty: "easy" as const,
    category: "Dinner",
    tags: [],
    sourceUrl: null,
    bookTitle: null,
    bookAuthor: null,
    bookPage: null,
    ingredients: [],
    steps: [{ id: STEP_ID, order: 0, text: "Cook." }],
    notesMarkdown: "",
    media: opts.media,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

interface RecipeSeed {
  recipe: ReturnType<typeof recipe>;
  mediaBytes: Record<string, Buffer>;
}
async function writeSeed(recipes: RecipeSeed[], opts: { noManifest?: boolean } = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "marcia-demo-seed-"));
  await mkdir(join(dir, "config"), { recursive: true });
  await mkdir(join(dir, "accounts"), { recursive: true });
  await writeFile(join(dir, "config", "site.json"), JSON.stringify(site(), null, 2));
  await writeFile(join(dir, "accounts", `${OWNER_ID}.json`), JSON.stringify(owner(), null, 2));

  const manifest: {
    formatVersion: 1;
    generatedAt: string;
    origin: string;
    recipes: {
      id: string;
      slug: string;
      title: string;
      media: { id: string; isPrimary: boolean; fileName: string; sha256: string }[];
      recipeJson: string;
    }[];
    accounts: { id: string; username: string; type: string }[];
    siteConfig: string;
  } = {
    formatVersion: 1,
    generatedAt: NOW,
    origin: "test",
    recipes: [],
    accounts: [{ id: OWNER_ID, username: "owner", type: "owner" }],
    siteConfig: "config/site.json",
  };

  for (const entry of recipes) {
    const recipePath = join(dir, "recipes", entry.recipe.id, "recipe.json");
    await mkdir(dirnameSafe(recipePath), { recursive: true });
    await writeFile(recipePath, JSON.stringify(entry.recipe, null, 2));
    const mediaManifest: { id: string; isPrimary: boolean; fileName: string; sha256: string }[] = [];
    const mediaDir = join(dir, "recipes", entry.recipe.id, "media");
    await mkdir(mediaDir, { recursive: true });
    for (const item of entry.recipe.media) {
      const bytes = entry.mediaBytes[item.id] ?? Buffer.from([]);
      await writeFile(join(mediaDir, item.fileName), bytes);
      mediaManifest.push({
        id: item.id,
        isPrimary: item.isPrimary,
        fileName: item.fileName,
        sha256: sha256(bytes),
      });
    }
    manifest.recipes.push({
      id: entry.recipe.id,
      slug: entry.recipe.slug,
      title: entry.recipe.title,
      media: mediaManifest,
      recipeJson: `recipes/${entry.recipe.id}/recipe.json`,
    });
  }

  if (!opts.noManifest) {
    await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  }
  return dir;
}

function dirnameSafe(p: string): string {
  // Avoid importing dirname twice; use the helper inline.
  return p.slice(0, p.lastIndexOf("/"));
}

beforeEach(async () => {
  delete process.env.DATA_ROOT;
  resetEnvCache();
});

afterEach(async () => {
  if (seedDir) await rm(seedDir, { recursive: true, force: true }).catch(() => undefined);
  if (root) {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
    await rm(`${root}.rollback`, { recursive: true, force: true }).catch(() => undefined);
    await rm(`${root}.locks`, { recursive: true, force: true }).catch(() => undefined);
    await rm(`${root}.restore-swap.json`, { force: true }).catch(() => undefined);
    try {
      // Only sweep staging dirs created by THIS pid (extractArchive prefixes
      // with `${process.pid}-`); sweeping any `.marcia-restore-` would race
      // with parallel test forks sharing /tmp.
      const prefix = `.marcia-restore-${process.pid}-`;
      for (const entry of await readdir(join(root, ".."))) {
        if (entry.startsWith(prefix)) {
          await rm(join(root, "..", entry), { recursive: true, force: true }).catch(() => undefined);
        }
      }
    } catch {
      // ignore
    }
  }
  delete process.env.DATA_ROOT;
  resetEnvCache();
  seedDir = undefined;
  root = undefined;
});

async function primeFreshRoot(dataRoot: string): Promise<void> {
  // restoreBackup requires the live root to exist before the swap. `ensureDataRoot`
  // would create the canonical layout; for restore safety we only need the dir.
  if (!existsSync(dataRoot)) await mkdir(dataRoot, { recursive: true });
}

describe("restore-demo-seed", () => {
  it("writes the primary media under its actual media id when primary is NOT at index 0", async () => {
    root = await mkdtemp(join(tmpdir(), "marcia-restore-demo-seed-root-"));
    seedDir = await writeSeed([
      {
        recipe: recipe({
          id: BURGER_RECIPE_ID,
          slug: "classic-beef-burger",
          title: "Classic Beef Burger",
          // The original bug wrote primary bytes under media[0].id. Verify that
          // the primary bytes are now written under the PRIMARY id, regardless of
          // position.
          media: [
            mediaItem({ id: SECONDARY_MEDIA_ID, isPrimary: false, bytes: 4 }),
            mediaItem({ id: PRIMARY_MEDIA_ID, isPrimary: true, bytes: 7 }),
          ],
        }),
        mediaBytes: {
          [SECONDARY_MEDIA_ID]: Buffer.from("SE00", "utf8"),
          [PRIMARY_MEDIA_ID]: Buffer.from("PRIMARY", "utf8"),
        },
      },
    ]);

    process.env.DATA_ROOT = root;
    resetEnvCache();
    await primeFreshRoot(root);

    const result = await restoreDemoSeed({ seedDirAbs: seedDir, force: true });
    expect(result.restored).toBe(true);

    const primaryFile = join(root, "recipes", BURGER_RECIPE_ID, "media", `${PRIMARY_MEDIA_ID}.webp`);
    const secondaryFile = join(root, "recipes", BURGER_RECIPE_ID, "media", `${SECONDARY_MEDIA_ID}.webp`);
    expect(existsSync(primaryFile)).toBe(true);
    expect(existsSync(secondaryFile)).toBe(true);
    expect((await readFile(primaryFile)).toString("utf8")).toBe("PRIMARY");
    expect((await readFile(secondaryFile)).toString("utf8")).toBe("SE00");
  });

  it("keeps the primary <-> id association intact when the media array is reordered", async () => {
    root = await mkdtemp(join(tmpdir(), "marcia-restore-demo-seed-root-"));
    const reorderedRecipe = recipe({
      id: BURGER_RECIPE_ID,
      slug: "classic-beef-burger",
      title: "Classic Beef Burger",
      // Reverse order from the first test: primary NOW at index 0.
      media: [
        mediaItem({ id: PRIMARY_MEDIA_ID, isPrimary: true, bytes: 7 }),
        mediaItem({ id: SECONDARY_MEDIA_ID, isPrimary: false, bytes: 4 }),
      ],
    });
    seedDir = await writeSeed([
      {
        recipe: reorderedRecipe,
        mediaBytes: {
          [SECONDARY_MEDIA_ID]: Buffer.from("SE00", "utf8"),
          [PRIMARY_MEDIA_ID]: Buffer.from("PRIMARY", "utf8"),
        },
      },
    ]);

    process.env.DATA_ROOT = root;
    resetEnvCache();
    await primeFreshRoot(root);

    await restoreDemoSeed({ seedDirAbs: seedDir, force: true });

    const primaryFile = join(root, "recipes", BURGER_RECIPE_ID, "media", `${PRIMARY_MEDIA_ID}.webp`);
    const secondaryFile = join(root, "recipes", BURGER_RECIPE_ID, "media", `${SECONDARY_MEDIA_ID}.webp`);
    expect((await readFile(primaryFile)).toString("utf8")).toBe("PRIMARY");
    expect((await readFile(secondaryFile)).toString("utf8")).toBe("SE00");
  });

  it("preserves recipe id, media id, primary selection, and filename across a full seed -> restore round trip", async () => {
    root = await mkdtemp(join(tmpdir(), "marcia-restore-demo-seed-root-"));
    const burgerMedia = mediaItem({ id: PRIMARY_MEDIA_ID, isPrimary: true, bytes: 3 });
    const pancakesMedia = mediaItem({ id: SECONDARY_MEDIA_ID, isPrimary: true, bytes: 3 });
    seedDir = await writeSeed([
      {
        recipe: recipe({
          id: BURGER_RECIPE_ID,
          slug: "classic-beef-burger",
          title: "Classic Beef Burger",
          media: [burgerMedia],
        }),
        mediaBytes: { [PRIMARY_MEDIA_ID]: Buffer.from([0x42, 0x55, 0x47]) },
      },
      {
        recipe: recipe({
          id: PANCAKES_RECIPE_ID,
          slug: "fluffy-buttermilk-pancakes",
          title: "Fluffy Buttermilk Pancakes",
          media: [pancakesMedia],
        }),
        mediaBytes: { [SECONDARY_MEDIA_ID]: Buffer.from([0x50, 0x43, 0x4b]) },
      },
    ]);

    process.env.DATA_ROOT = root;
    resetEnvCache();
    await primeFreshRoot(root);

    const result = await restoreDemoSeed({ seedDirAbs: seedDir, force: true });
    expect(result.restored).toBe(true);
    expect(result.recipes).toBe(2);
    expect(result.mediaFiles).toBe(2);

    const burgerRecipe = JSON.parse(
      await readFile(join(root, "recipes", BURGER_RECIPE_ID, "recipe.json"), "utf8"),
    );
    expect(burgerRecipe.id).toBe(BURGER_RECIPE_ID);
    expect(burgerRecipe.media[0].id).toBe(PRIMARY_MEDIA_ID);
    expect(burgerRecipe.media[0].isPrimary).toBe(true);
    expect(burgerRecipe.media[0].fileName).toBe(`${PRIMARY_MEDIA_ID}.webp`);
    expect(existsSync(join(root, "recipes", BURGER_RECIPE_ID, "media", `${PRIMARY_MEDIA_ID}.webp`))).toBe(true);

    const pancakesRecipe = JSON.parse(
      await readFile(join(root, "recipes", PANCAKES_RECIPE_ID, "recipe.json"), "utf8"),
    );
    expect(pancakesRecipe.id).toBe(PANCAKES_RECIPE_ID);
    expect(pancakesRecipe.media[0].id).toBe(SECONDARY_MEDIA_ID);
    expect(pancakesRecipe.media[0].isPrimary).toBe(true);
    expect(existsSync(join(root, "recipes", PANCAKES_RECIPE_ID, "media", `${SECONDARY_MEDIA_ID}.webp`))).toBe(
      true,
    );
  });

  it("fails loudly when a recipe references media that is missing from the seed", async () => {
    root = await mkdtemp(join(tmpdir(), "marcia-restore-demo-seed-root-"));
    seedDir = await mkdtemp(join(tmpdir(), "marcia-demo-seed-orphan-"));
    await mkdir(join(seedDir, "config"), { recursive: true });
    await mkdir(join(seedDir, "accounts"), { recursive: true });
    await writeFile(join(seedDir, "config", "site.json"), JSON.stringify(site(), null, 2));
    await writeFile(join(seedDir, "accounts", `${OWNER_ID}.json`), JSON.stringify(owner(), null, 2));

    // Recipe media references a primary id, but the seed directory has the file
    // for that id; we then DELETE the file to simulate an incomplete seed.
    const r = recipe({
      id: BURGER_RECIPE_ID,
      slug: "classic-beef-burger",
      title: "Classic Beef Burger",
      media: [mediaItem({ id: PRIMARY_MEDIA_ID, isPrimary: true, bytes: 7 })],
    });
    const recipeDir = join(seedDir, "recipes", BURGER_RECIPE_ID);
    await mkdir(join(recipeDir, "media"), { recursive: true });
    await writeFile(join(recipeDir, "recipe.json"), JSON.stringify(r, null, 2));
    await writeFile(join(recipeDir, "media", `${PRIMARY_MEDIA_ID}.webp`), Buffer.from("PRIMARY", "utf8"));

    const manifest = {
      formatVersion: 1 as const,
      generatedAt: NOW,
      origin: "test",
      recipes: [
        {
          id: BURGER_RECIPE_ID,
          slug: "classic-beef-burger",
          title: "Classic Beef Burger",
          media: [
            {
              id: PRIMARY_MEDIA_ID,
              isPrimary: true,
              fileName: `${PRIMARY_MEDIA_ID}.webp`,
              sha256: sha256(Buffer.from("PRIMARY", "utf8")),
            },
          ],
          recipeJson: `recipes/${BURGER_RECIPE_ID}/recipe.json`,
        },
      ],
      accounts: [{ id: OWNER_ID, username: "owner", type: "owner" }],
      siteConfig: "config/site.json",
    };
    await writeFile(join(seedDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    // Now delete the media file. validateSeedDir(restoreDemoSeed) should reject.
    await rm(join(recipeDir, "media", `${PRIMARY_MEDIA_ID}.webp`));

    process.env.DATA_ROOT = root;
    resetEnvCache();
    await primeFreshRoot(root);

    await expect(restoreDemoSeed({ seedDirAbs: seedDir, force: true })).rejects.toThrow(
      /missing file|media file missing from seed/i,
    );
  });

  it("fails loudly when a media file's sha256 does not match the manifest", async () => {
    root = await mkdtemp(join(tmpdir(), "marcia-restore-demo-seed-root-"));
    const wrongBytes = Buffer.from("WASN'T-ME", "utf8");
    const expectedSha = sha256(Buffer.from("WASME", "utf8"));
    seedDir = await mkdtemp(join(tmpdir(), "marcia-demo-seed-badsha-"));
    await mkdir(join(seedDir, "config"), { recursive: true });
    await mkdir(join(seedDir, "accounts"), { recursive: true });
    await mkdir(join(seedDir, "recipes", BURGER_RECIPE_ID, "media"), { recursive: true });
    await writeFile(join(seedDir, "config", "site.json"), JSON.stringify(site(), null, 2));
    await writeFile(join(seedDir, "accounts", `${OWNER_ID}.json`), JSON.stringify(owner(), null, 2));
    const r = recipe({
      id: BURGER_RECIPE_ID,
      slug: "classic-beef-burger",
      title: "Classic Beef Burger",
      media: [mediaItem({ id: PRIMARY_MEDIA_ID, isPrimary: true, bytes: wrongBytes.length })],
    });
    await writeFile(join(seedDir, "recipes", BURGER_RECIPE_ID, "recipe.json"), JSON.stringify(r, null, 2));
    await writeFile(join(seedDir, "recipes", BURGER_RECIPE_ID, "media", `${PRIMARY_MEDIA_ID}.webp`), wrongBytes);
    const manifest = {
      formatVersion: 1 as const,
      generatedAt: NOW,
      origin: "test",
      recipes: [
        {
          id: BURGER_RECIPE_ID,
          slug: "classic-beef-burger",
          title: "Classic Beef Burger",
          media: [
            {
              id: PRIMARY_MEDIA_ID,
              isPrimary: true,
              fileName: `${PRIMARY_MEDIA_ID}.webp`,
              sha256: expectedSha,
            },
          ],
          recipeJson: `recipes/${BURGER_RECIPE_ID}/recipe.json`,
        },
      ],
      accounts: [{ id: OWNER_ID, username: "owner", type: "owner" }],
      siteConfig: "config/site.json",
    };
    await writeFile(join(seedDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    process.env.DATA_ROOT = root;
    resetEnvCache();
    await primeFreshRoot(root);

    await expect(restoreDemoSeed({ seedDirAbs: seedDir, force: true })).rejects.toThrow(/sha256/);
  });

  it("validateSeedDir rejects a seed with an orphan media file not described in the manifest", async () => {
    root = await mkdtemp(join(tmpdir(), "marcia-restore-demo-seed-root-"));
    const orphanId = "00000000-0000-4000-8000-00000000dead";
    const orphanBytes = Buffer.from("ORPHAN", "utf8");
    seedDir = await writeSeed([
      {
        recipe: recipe({
          id: BURGER_RECIPE_ID,
          slug: "classic-beef-burger",
          title: "Classic Beef Burger",
          media: [mediaItem({ id: PRIMARY_MEDIA_ID, isPrimary: true, bytes: 7 })],
        }),
        mediaBytes: { [PRIMARY_MEDIA_ID]: Buffer.from("PRIMARY", "utf8") },
      },
    ]);
    // Drop in an orphan webp the manifest never declared.
    await writeFile(
      join(seedDir, "recipes", BURGER_RECIPE_ID, "media", `${orphanId}.webp`),
      orphanBytes,
    );

    // Pre-populate a manifest entry that names the orphan sha? No — never
    // declared; the validator must reject it.
    // Also need a DATA_ROOT to satisfy restoreBackup's `getDataRoot()` call? No
    // — validateSeedDir is pure (no DATA_ROOT).  Use it directly.
    await expect(validateSeedDir(seedDir)).rejects.toThrow(/orphan media file not in manifest/);
  });
});