import type { Recipe, SearchIndex, SearchIndexEntry } from "@/types";
import { nowIso } from "@/lib/time";
import { searchIndexSchema } from "@/lib/validation/schemas";
import { SCHEMA_VERSIONS } from "@/lib/validation/constants";
import { readJson, writeJsonAtomic } from "./atomic";
import { withLock } from "./lock";
import { resolveWithin } from "./paths";
import { quarantineFile } from "./quarantine";
import { listRecipes } from "./repositories/recipes";
import { join } from "node:path";

const indexPath = () => resolveWithin("indexes", "search.json");

function toEntry(recipe: Recipe): SearchIndexEntry {
  return {
    id: recipe.id,
    slug: recipe.slug,
    title: recipe.title,
    description: recipe.description,
    category: recipe.category,
    tags: recipe.tags,
    visibility: recipe.visibility,
    archived: recipe.archivedAt !== null,
    primaryMediaId: recipe.media.find((m) => m.isPrimary)?.id ?? recipe.media[0]?.id ?? null,
    prepMinutes: recipe.prepMinutes,
    cookMinutes: recipe.cookMinutes,
    totalMinutes: (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0) || null,
    difficulty: recipe.difficulty,
  };
}

/** Build the disposable index without consulting DATA_ROOT. */
export function buildSearchIndex(recipes: Recipe[]): SearchIndex {
  const slugToId: Record<string, string> = {};
  const entries: SearchIndexEntry[] = [];
  for (const recipe of recipes) {
    slugToId[recipe.slug] = recipe.id;
    for (const alias of recipe.previousSlugs) {
      // Aliases never shadow a live slug.
      if (!(alias in slugToId)) slugToId[alias] = recipe.id;
    }
    entries.push(toEntry(recipe));
  }
  entries.sort((a, b) => a.title.localeCompare(b.title));
  return {
    schemaVersion: SCHEMA_VERSIONS.searchIndex,
    builtAt: nowIso(),
    slugToId,
    entries,
  };
}

/** Write an index for a root that is not the live DATA_ROOT (restore staging). */
export async function writeSearchIndexAt(root: string, recipes: Recipe[]): Promise<SearchIndex> {
  const index = buildSearchIndex(recipes);
  await writeJsonAtomic(join(root, "indexes", "search.json"), index);
  return index;
}

/**
 * Rebuild the derived search/slug index from canonical recipe files.
 * The index is disposable: delete it and it is rebuilt on demand.
 */
export async function rebuildSearchIndex(): Promise<SearchIndex> {
  const recipes = await listRecipes();
  const index = buildSearchIndex(recipes);
  await writeJsonAtomic(indexPath(), index);
  return index;
}

/** Load the index, rebuilding when missing or unreadable (derived data self-heals). */
export async function getSearchIndex(): Promise<SearchIndex> {
  return withLock("root-swap", async () => {
    const index = await readJson(indexPath(), searchIndexSchema, { quarantine: quarantineFile });
    if (index) return index;
    return rebuildSearchIndex();
  });
}

/** Resolve a slug (current or alias) to a recipe id. */
export async function resolveSlug(slug: string): Promise<string | null> {
  const index = await getSearchIndex();
  return index.slugToId[slug] ?? null;
}
