import type { Account, Recipe, ResolvedVisibility, SiteConfig } from "@/types";
import { hasCapability } from "./capabilities";

/** Resolve `inherit` against the site default. */
export function resolveVisibility(
  recipe: Pick<Recipe, "visibility">,
  siteConfig: Pick<SiteConfig, "defaultVisibility">,
): ResolvedVisibility {
  return recipe.visibility === "inherit" ? siteConfig.defaultVisibility : recipe.visibility;
}

/**
 * Single source of truth for recipe visibility:
 * - enabled owners see everything
 * - `owner` recipes: owner only
 * - `members` recipes: any enabled account holding `recipes.read`
 * - `public` recipes: everyone, including anonymous visitors
 * `inherit` resolves against the site default (`public` or `members`).
 */
export function canViewRecipe(
  recipe: Pick<Recipe, "visibility">,
  siteConfig: Pick<SiteConfig, "defaultVisibility">,
  account: Account | null,
): boolean {
  if (account?.type === "owner" && account.disabledAt === null) return true;
  const resolved = resolveVisibility(recipe, siteConfig);
  if (resolved === "owner") return false;
  if (resolved === "members") return hasCapability(account, "recipes.read");
  return true;
}

/** Filter helper applying canViewRecipe across a collection. */
export function filterVisible<T extends Pick<Recipe, "visibility">>(
  items: T[],
  siteConfig: Pick<SiteConfig, "defaultVisibility">,
  account: Account | null,
): T[] {
  return items.filter((item) => canViewRecipe(item, siteConfig, account));
}
