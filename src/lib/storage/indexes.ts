import type { Recipe, SearchIndex, SearchIndexEntry } from "@/types";
import { nowIso } from "@/lib/time";
import { searchIndexSchema } from "@/lib/validation/schemas";
import { SCHEMA_VERSIONS } from "@/lib/validation/constants";
import { readJson, writeJsonAtomic } from "./atomic";
import { resolveWithin } from "./paths";
import { listRecipes } from "./repositories/recipes";

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
  };
}

/**
 * Rebuild the derived search/slug index from canonical recipe files.
 * The index is disposable: delete it and it is rebuilt on demand.
 */
export async function rebuildSearchIndex(): Promise<SearchIndex> {
  const recipes = await listRecipes();
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
  const index: SearchIndex = {
    schemaVersion: SCHEMA_VERSIONS.searchIndex,
    builtAt: nowIso(),
    slugToId,
    entries,
  };
  await writeJsonAtomic(indexPath(), index);
  return index;
}

/** Load the index, rebuilding when missing or unreadable (derived data self-heals). */
export async function getSearchIndex(): Promise<SearchIndex> {
  const index = await readJson(indexPath(), searchIndexSchema);
  if (index) return index;
  return rebuildSearchIndex();
}

/** Resolve a slug (current or alias) to a recipe id. */
export async function resolveSlug(slug: string): Promise<string | null> {
  const index = await getSearchIndex();
  return index.slugToId[slug] ?? null;
}
