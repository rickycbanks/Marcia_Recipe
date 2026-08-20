import type { Recipe, SearchIndex, SearchIndexEntry, SuggestionIndex } from "@/types";
import { nowIso } from "@/lib/time";
import { searchIndexSchema, suggestionIndexSchema } from "@/lib/validation/schemas";
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

/* ----------------------------- suggestion index ---------------------------- */

const suggestionIndexPath = () => resolveWithin("indexes", "suggestions.json");

/**
 * Collect unique, trimmed, case-folded values from recipes. The first-seen
 * casing is preserved as the display value; case-folded forms are only used
 * for deduplication.
 */
function collectUniqueSorted(recipes: Recipe[], extractor: (r: Recipe) => (string | null | undefined)[]): string[] {
  const seen = new Map<string, string>();
  for (const recipe of recipes) {
    for (const raw of extractor(recipe)) {
      const trimmed = raw?.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (!seen.has(key)) seen.set(key, trimmed);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Build the disposable suggestion index without consulting DATA_ROOT. */
export function buildSuggestionIndex(recipes: Recipe[]): SuggestionIndex {
  const categories = collectUniqueSorted(recipes, (r) => [r.category]);
  const tags = collectUniqueSorted(recipes, (r) => r.tags);
  const bookTitles = collectUniqueSorted(recipes, (r) => [r.bookTitle]);
  const bookAuthors = collectUniqueSorted(recipes, (r) => [r.bookAuthor]);
  const ingredientUnits = collectUniqueSorted(recipes, (r) => r.ingredients.map((i) => i.unit));

  // Ingredient names: ordered by descending usage count (most-used first),
  // preserving first-seen casing.
  const nameCounts = new Map<string, { count: number; display: string }>();
  for (const recipe of recipes) {
    for (const ingredient of recipe.ingredients) {
      const trimmed = ingredient.name.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      const existing = nameCounts.get(key);
      if (existing) {
        existing.count++;
      } else {
        nameCounts.set(key, { count: 1, display: trimmed });
      }
    }
  }
  const ingredientNames = [...nameCounts.values()]
    .sort((a, b) => b.count - a.count || a.display.localeCompare(b.display))
    .map((e) => e.display);

  return {
    schemaVersion: SCHEMA_VERSIONS.suggestionIndex,
    builtAt: nowIso(),
    categories,
    tags,
    bookTitles,
    bookAuthors,
    ingredientUnits,
    ingredientNames,
  };
}

/** Write an index for a root that is not the live DATA_ROOT (restore staging). */
export async function writeSuggestionIndexAt(root: string, recipes: Recipe[]): Promise<SuggestionIndex> {
  const index = buildSuggestionIndex(recipes);
  await writeJsonAtomic(join(root, "indexes", "suggestions.json"), index);
  return index;
}

/**
 * Rebuild the disposable suggestion index from canonical recipe files.
 */
export async function rebuildSuggestionIndex(): Promise<SuggestionIndex> {
  const recipes = await listRecipes();
  const index = buildSuggestionIndex(recipes);
  await writeJsonAtomic(suggestionIndexPath(), index);
  return index;
}

/** Load the suggestion index, rebuilding when missing or unreadable. */
export async function getSuggestionIndex(): Promise<SuggestionIndex> {
  return withLock("root-swap", async () => {
    const index = await readJson(suggestionIndexPath(), suggestionIndexSchema, { quarantine: quarantineFile });
    if (index) return index;
    return rebuildSuggestionIndex();
  });
}
