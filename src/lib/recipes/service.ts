import type { Account, Recipe, RecipeDraft } from "@/types";
import { audit } from "@/lib/audit/log";
import { conflict, forbidden, notFound } from "@/lib/errors";
import { newId, slugify } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { SCHEMA_VERSIONS } from "@/lib/validation/constants";
import { recipeSchema } from "@/lib/validation/schemas";
import { getSearchIndex, rebuildSearchIndex, rebuildSuggestionIndex, resolveSlug } from "@/lib/storage/indexes";
import { withWriteLock } from "@/lib/storage/lock";
import {
  deleteRecipeDir,
  getRecipe,
  listRecipes,
  saveRecipe,
} from "@/lib/storage/repositories/recipes";
import { listMealPlans } from "@/lib/storage/repositories/mealPlans";
import { listAccounts } from "@/lib/storage/repositories/accounts";
import { canViewRecipe } from "@/lib/authorization/visibility";
import { getSiteConfig } from "@/lib/storage/repositories/config";
import { attachStagedMediaToRecipe } from "@/lib/media/service";

/* ------------------------------ slug management ----------------------------- */

/** Slugs are presentation-only; relationships use immutable UUIDs. */
async function uniqueSlug(baseInput: string, excludeRecipeId?: string): Promise<string> {
  const base = slugify(baseInput);
  const index = await getSearchIndex();
  const ownerOf = (slug: string) => index.slugToId[slug];
  if (!ownerOf(base) || ownerOf(base) === excludeRecipeId) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`.slice(0, 80);
    if (!ownerOf(candidate) || ownerOf(candidate) === excludeRecipeId) return candidate;
  }
  throw conflict("Could not allocate a unique slug");
}

/* --------------------------------- queries ---------------------------------- */

export interface ResolvedRecipe {
  recipe: Recipe;
  /** true when the requested slug was an alias — callers should redirect to the canonical slug. */
  viaAlias: boolean;
}

/** Load a recipe by slug only when the account may view it; otherwise behave as if absent. */
export async function getVisibleRecipeBySlug(
  slug: string,
  account: Account | null,
): Promise<ResolvedRecipe | null> {
  const id = await resolveSlug(slug);
  if (!id) return null;
  const recipe = await getRecipe(id);
  if (!recipe) return null;
  const config = await getSiteConfig();
  if (!canViewRecipe(recipe, config, account)) return null;
  if (recipe.archivedAt !== null && account?.type !== "owner") return null;
  return { recipe, viaAlias: recipe.slug !== slug };
}

export async function getRecipeForOwner(id: string): Promise<Recipe> {
  const recipe = await getRecipe(id);
  if (!recipe) throw notFound("Recipe not found");
  return recipe;
}

/** All recipes for owner admin screens (including archived). */
export async function listAllRecipesForOwner(): Promise<Recipe[]> {
  const recipes = await listRecipes();
  return recipes.sort((a, b) => a.title.localeCompare(b.title));
}

/* --------------------------------- mutations -------------------------------- */

function materializeDraft(draft: RecipeDraft, base: Partial<Recipe> & { id: string; slug: string; createdAt: string }): Recipe {
  const now = nowIso();
  return recipeSchema.parse({
    schemaVersion: SCHEMA_VERSIONS.recipe,
    id: base.id,
    slug: base.slug,
    previousSlugs: base.previousSlugs ?? [],
    visibility: draft.visibility,
    title: draft.title,
    description: draft.description,
    prepMinutes: draft.prepMinutes,
    cookMinutes: draft.cookMinutes,
    servings: draft.servings,
    difficulty: draft.difficulty,
    category: draft.category,
    tags: draft.tags,
    sourceUrl: draft.sourceUrl,
    bookTitle: draft.bookTitle,
    bookAuthor: draft.bookAuthor,
    bookPage: draft.bookPage,
    ingredients: draft.ingredients.map((ingredient, order) => ({ id: newId(), order, ...ingredient })),
    steps: draft.steps.map((text, order) => ({ id: newId(), order, text })),
    notesMarkdown: draft.notesMarkdown,
    media: base.media ?? [],
    archivedAt: base.archivedAt ?? null,
    createdAt: base.createdAt,
    updatedAt: now,
  });
}

/** Owner-only creation. Authorization is enforced HERE, not just in routes. */
export async function createRecipe(account: Account, draft: RecipeDraft): Promise<Recipe> {
  if (account.type !== "owner") throw forbidden("Only the owner can manage recipes");
  return withWriteLock(async () => {
    const slug = await uniqueSlug(draft.slug ?? draft.title);
    const recipeId = newId();
    // Attach any staged media under the same write lock so the recipe and its
    // media appear atomically. Staged items missing from tmp/ are skipped.
    const media = await attachStagedMediaToRecipe(recipeId, draft.stagedMedia, true);
    const recipe = materializeDraft(draft, { id: recipeId, slug, createdAt: nowIso(), media });
    await saveRecipe(recipe);
    await rebuildSearchIndex();
    await rebuildSuggestionIndex();
    await audit({
      type: "recipe.created",
      actorAccountId: account.id,
      clientAddress: null,
      detail: { recipeId: recipe.id, slug: recipe.slug, title: recipe.title },
    });
    return recipe;
  });
}

/** Owner-only update. Slug renames preserve the old slug as an alias. */
export async function updateRecipe(account: Account, id: string, draft: RecipeDraft): Promise<Recipe> {
  if (account.type !== "owner") throw forbidden("Only the owner can manage recipes");
  return withWriteLock(async () => {
    const existing = await getRecipe(id);
    if (!existing) throw notFound("Recipe not found");

    let slug = existing.slug;
    const previousSlugs = [...existing.previousSlugs];
    const requestedSlug = draft.slug ?? existing.slug;
    if (requestedSlug !== existing.slug) {
      slug = await uniqueSlug(requestedSlug, existing.id);
      if (slug !== existing.slug && !previousSlugs.includes(existing.slug)) {
        previousSlugs.push(existing.slug);
      }
    }

    const recipe = materializeDraft(draft, {
      id: existing.id,
      slug,
      previousSlugs,
      media: existing.media,
      archivedAt: existing.archivedAt,
      createdAt: existing.createdAt,
    });
    await saveRecipe(recipe);
    await rebuildSearchIndex();
    await rebuildSuggestionIndex();
    await audit({
      type: "recipe.updated",
      actorAccountId: account.id,
      clientAddress: null,
      detail: { recipeId: recipe.id, slug: recipe.slug },
    });
    return recipe;
  });
}

/** Soft-delete: archived recipes vanish from lists but remain as tombstones in meal plans. */
export async function archiveRecipe(account: Account, id: string): Promise<Recipe> {
  if (account.type !== "owner") throw forbidden("Only the owner can manage recipes");
  return withWriteLock(async () => {
    const existing = await getRecipe(id);
    if (!existing) throw notFound("Recipe not found");
    const recipe = { ...existing, archivedAt: nowIso(), updatedAt: nowIso() };
    await saveRecipe(recipe);
    await rebuildSearchIndex();
    await rebuildSuggestionIndex();
    await audit({ type: "recipe.archived", actorAccountId: account.id, clientAddress: null, detail: { recipeId: id } });
    return recipe;
  });
}

export async function restoreRecipe(account: Account, id: string): Promise<Recipe> {
  if (account.type !== "owner") throw forbidden("Only the owner can manage recipes");
  return withWriteLock(async () => {
    const existing = await getRecipe(id);
    if (!existing) throw notFound("Recipe not found");
    const recipe = { ...existing, archivedAt: null, updatedAt: nowIso() };
    await saveRecipe(recipe);
    await rebuildSearchIndex();
    await rebuildSuggestionIndex();
    await audit({ type: "recipe.restored", actorAccountId: account.id, clientAddress: null, detail: { recipeId: id } });
    return recipe;
  });
}

/**
 * Permanent deletion is blocked while any meal plan still references the
 * recipe (plans keep tombstones instead). Archival is the default.
 */
export async function deleteRecipePermanently(account: Account, id: string): Promise<void> {
  if (account.type !== "owner") throw forbidden("Only the owner can manage recipes");
  await withWriteLock(async () => {
    const existing = await getRecipe(id);
    if (!existing) throw notFound("Recipe not found");
    if (existing.archivedAt === null) {
      throw conflict("Archive the recipe before deleting it permanently");
    }
    const accounts = await listAccounts();
    for (const acc of accounts) {
      const plans = await listMealPlans(acc.id);
      for (const plan of plans) {
        if (plan.entries.some((e) => e.recipeId === id)) {
          throw conflict(
            "Recipe is still referenced by a meal plan; permanent deletion is blocked",
            { accountId: acc.id, weekId: plan.weekId },
          );
        }
      }
    }
    await deleteRecipeDir(id);
    await rebuildSearchIndex();
    await rebuildSuggestionIndex();
    await audit({
      type: "recipe.updated",
      actorAccountId: account.id,
      clientAddress: null,
      detail: { recipeId: id, deletedPermanently: true },
    });
  });
}

/* ------------------------------ planner support ----------------------------- */

export interface PlannerRecipeRef {
  id: string;
  title: string;
  slug: string;
  archived: boolean;
  viewable: boolean;
}

/**
 * Resolve recipe references for meal-plan rendering. Archived or deleted
 * recipes become safe tombstones; recipes the account can no longer view are
 * shown as unavailable placeholders without leaking metadata.
 */
export async function resolveRecipeRefs(
  recipeIds: string[],
  account: Account | null,
): Promise<Map<string, PlannerRecipeRef>> {
  const config = await getSiteConfig();
  const result = new Map<string, PlannerRecipeRef>();
  for (const id of new Set(recipeIds)) {
    const recipe = await getRecipe(id);
    if (!recipe) {
      result.set(id, { id, title: "Unavailable recipe", slug: "", archived: true, viewable: false });
      continue;
    }
    const archived = recipe.archivedAt !== null;
    const viewable = !archived && canViewRecipe(recipe, config, account);
    result.set(id, {
      id,
      title: archived ? `${recipe.title} (archived)` : recipe.title,
      slug: recipe.slug,
      archived,
      viewable,
    });
  }
  return result;
}

