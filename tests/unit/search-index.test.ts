import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { writeJsonAtomic } from "@/lib/storage/atomic";
import { ensureDataRoot, getDataRoot } from "@/lib/storage/dataRoot";
import { getSearchIndex, resolveSlug } from "@/lib/storage/indexes";

const RECIPE_ID = "00000000-0000-4000-8000-000000000002";
const STEP_ID = "00000000-0000-4000-8000-000000000003";
const NOW = "2026-01-01T00:00:00.000Z";

let root: string | undefined;

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

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  delete process.env.DATA_ROOT;
  resetEnvCache();
  root = undefined;
});

describe("search index self-heal", () => {
  it("rebuilds the index from recipe files when it is missing", async () => {
    root = await mkdtemp(join(tmpdir(), "index-missing-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await ensureDataRoot();
    await writeJsonAtomic(join(getDataRoot(), "recipes", RECIPE_ID, "recipe.json"), recipeV2());

    const index = await getSearchIndex();
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0]!.slug).toBe("tomato-pasta");
    expect(index.slugToId["tomato-pasta"]).toBe(RECIPE_ID);
    expect(await resolveSlug("tomato-pasta")).toBe(RECIPE_ID);
  });

  it("quarantines a corrupt index and rebuilds it instead of throwing", async () => {
    root = await mkdtemp(join(tmpdir(), "index-corrupt-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await ensureDataRoot();
    await writeJsonAtomic(join(getDataRoot(), "recipes", RECIPE_ID, "recipe.json"), recipeV2());
    await writeFile(join(getDataRoot(), "indexes", "search.json"), "{ this is not json", "utf8");

    // Must not throw STORAGE_CORRUPT — the corrupt file is quarantined and rebuilt.
    const index = await getSearchIndex();
    expect(index.entries).toHaveLength(1);
    expect(index.slugToId["tomato-pasta"]).toBe(RECIPE_ID);

    const files = await readdir(join(getDataRoot(), "indexes"));
    expect(files.some((file) => file.startsWith("search.json.corrupt-"))).toBe(true);
  });

  it("reads a valid index without rebuilding it", async () => {
    root = await mkdtemp(join(tmpdir(), "index-valid-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await ensureDataRoot();
    await writeJsonAtomic(join(getDataRoot(), "recipes", RECIPE_ID, "recipe.json"), recipeV2());

    const built = await getSearchIndex();
    const cached = await getSearchIndex();
    expect(cached.builtAt).toBe(built.builtAt);
    expect(cached.entries).toEqual(built.entries);
  });
});
