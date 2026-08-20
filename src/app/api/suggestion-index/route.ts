import { apiHandler, jsonOk } from "@/lib/api";
import { getSessionAccount } from "@/lib/authorization/guards";
import { canViewRecipe } from "@/lib/authorization/visibility";
import { buildSuggestionIndex, getSuggestionIndex } from "@/lib/storage/indexes";
import { getSiteConfig } from "@/lib/storage/repositories/config";
import { listRecipes } from "@/lib/storage/repositories/recipes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Suggestion index for autocomplete fields. Owners receive the full index
 * (includes archived recipes). Non-owners receive suggestions recomputed
 * from non-archived, visible recipes only — archived data is owner-only.
 *
 * Approach: rather than tracking per-value provenance or adding a flag to the
 * index schema, we rebuild a lightweight suggestion index on the fly from the
 * filtered recipe list.  `buildSuggestionIndex` is a pure in-memory transform
 * with no I/O — trivial cost for a single-owner app with <2000 recipes.
 */
export const GET = apiHandler(async () => {
  const [account, siteConfig] = await Promise.all([getSessionAccount(), getSiteConfig()]);
  const isOwner = account?.type === "owner";

  if (isOwner) {
    const index = await getSuggestionIndex();
    return jsonOk({ ...index });
  }

  // Non-owners: exclude archived recipes and recipes the account cannot view,
  // then rebuild the suggestion index from the visible subset only.
  const recipes = await listRecipes();
  const visible = recipes.filter(
    (r) => r.archivedAt === null && canViewRecipe(r, siteConfig, account),
  );
  const index = buildSuggestionIndex(visible);
  return jsonOk({ ...index });
});
