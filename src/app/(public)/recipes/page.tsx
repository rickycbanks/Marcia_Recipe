import { RecipeCard } from "@/components/RecipeCard";
import { SearchBox } from "@/components/SearchBox";
import { EmptyState } from "@/components/EmptyState";
import Link from "next/link";
import { getSessionAccount } from "@/lib/authorization/guards";
import { hasCapability } from "@/lib/authorization/capabilities";
import { canViewRecipe } from "@/lib/authorization/visibility";
import { getSearchIndex } from "@/lib/storage/indexes";
import { getSiteConfig } from "@/lib/storage/repositories/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recipes" };

interface Props {
  searchParams: Promise<{ category?: string; tag?: string }>;
}

export default async function RecipesPage({ searchParams }: Props) {
  const { category, tag } = await searchParams;
  const [account, index, config] = await Promise.all([
    getSessionAccount(),
    getSearchIndex(),
    getSiteConfig(),
  ]);
  const visible = index.entries
    .filter((e) => !e.archived)
    .filter((e) => canViewRecipe(e, config, account));

  const categories = [...new Set(visible.map((e) => e.category).filter((c): c is string => !!c))].sort();
  const tags = [...new Set(visible.flatMap((e) => e.tags))].sort();

  const filtered = visible.filter((e) => {
    if (category && e.category !== category) return false;
    if (tag && !e.tags.includes(tag)) return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-3xl font-bold">Recipes</h1>
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
          <SearchBox />
          {hasCapability(account, "recipes.manage") ? (
            <Link href="/admin/recipes/new" className="btn-primary">
              + New recipe
            </Link>
          ) : null}
        </div>
      </div>

      {categories.length > 0 || tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm" aria-label="Filters">
          <span className="text-muted-foreground">Filter:</span>
          <Link href="/recipes" className={`badge ${!category && !tag ? "bg-accent text-accent-foreground" : ""}`}>
            All
          </Link>
          {categories.map((c) => (
            <Link key={c} href={`/recipes?category=${encodeURIComponent(c)}`} className={`badge ${category === c ? "bg-accent text-accent-foreground" : ""}`}>
              {c}
            </Link>
          ))}
          {tags.slice(0, 12).map((t) => (
            <Link key={t} href={`/recipes?tag=${encodeURIComponent(t)}`} className={`badge ${tag === t ? "bg-accent text-accent-foreground" : ""}`}>
              #{t}
            </Link>
          ))}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState title="No recipes found">
          <p>{visible.length === 0 ? "There are no recipes you can view yet." : "Try a different filter."}</p>
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((entry) => (
            <li key={entry.id}>
              <RecipeCard recipe={entry} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
