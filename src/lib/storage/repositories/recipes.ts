import { readdir, rm } from "node:fs/promises";
import type { Recipe } from "@/types";
import { assertUuid } from "@/lib/ids";
import { recipeSchema } from "@/lib/validation/schemas";
import { readJson, writeJsonAtomic } from "../atomic";
import { resolveWithin } from "../paths";
import { listSubdirectories } from "../repo";
import { quarantineFile } from "../quarantine";

const recipesDir = () => resolveWithin("recipes");
export const recipeDir = (id: string) => resolveWithin("recipes", assertUuid(id, "recipe id"));
export const recipePath = (id: string) => resolveWithin("recipes", assertUuid(id, "recipe id"), "recipe.json");
export const recipeMediaDir = (id: string) =>
  resolveWithin("recipes", assertUuid(id, "recipe id"), "media");

export async function getRecipe(id: string): Promise<Recipe | null> {
  return readJson(recipePath(id), recipeSchema);
}

/** Load every recipe; malformed documents are quarantined and skipped. */
export async function listRecipes(): Promise<Recipe[]> {
  const dirs = await listSubdirectories(recipesDir());
  const recipes: Recipe[] = [];
  for (const dir of dirs) {
    try {
      assertUuid(dir, "recipe directory");
    } catch {
      continue; // ignore foreign directories
    }
    const doc = await readJson(recipePath(dir), recipeSchema, { quarantine: quarantineFile });
    if (doc !== null) recipes.push(doc);
  }
  return recipes;
}

export async function saveRecipe(recipe: Recipe): Promise<void> {
  await writeJsonAtomic(recipePath(recipe.id), recipeSchema.parse(recipe));
}

/**
 * Permanently delete a recipe directory. Callers must check references first
 * (meal plans keep tombstones, so archival is normally preferred).
 */
export async function deleteRecipeDir(id: string): Promise<void> {
  await rm(recipeDir(id), { recursive: true, force: true });
}

/** Reference scan used to block permanent deletion while references exist. */
export async function recipeHasMediaFiles(id: string): Promise<boolean> {
  try {
    const files = await readdir(recipeMediaDir(id));
    return files.some((f) => f.endsWith(".webp"));
  } catch {
    return false;
  }
}
