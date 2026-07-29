import { apiHandler, jsonOk } from "@/lib/api";
import { getSessionAccount } from "@/lib/authorization/guards";
import { canViewRecipe } from "@/lib/authorization/visibility";
import { getSearchIndex } from "@/lib/storage/indexes";
import { getSiteConfig } from "@/lib/storage/repositories/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Visibility-filtered search index, computed per request. Anonymous visitors
 * receive only public entries; guests receive what their capabilities allow;
 * archived entries are owner-only.
 */
export const GET = apiHandler(async () => {
  const [account, index, config] = await Promise.all([getSessionAccount(), getSearchIndex(), getSiteConfig()]);
  const isOwner = account?.type === "owner";
  const entries = index.entries
    .filter((entry) => (isOwner ? true : !entry.archived))
    .filter((entry) => canViewRecipe(entry, config, account))
    .map(({ id, slug, title, description, category, tags, primaryMediaId }) => ({
      id,
      slug,
      title,
      description,
      category,
      tags,
      primaryMediaId,
    }));
  return jsonOk({ entries, builtAt: index.builtAt });
});
