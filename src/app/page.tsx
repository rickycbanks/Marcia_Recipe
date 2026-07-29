import Link from "next/link";
import { redirect } from "next/navigation";
import { RecipeCard } from "@/components/RecipeCard";
import { SearchBox } from "@/components/SearchBox";
import { EmptyState } from "@/components/EmptyState";
import { getSessionAccount } from "@/lib/authorization/guards";
import { canViewRecipe } from "@/lib/authorization/visibility";
import { getSearchIndex } from "@/lib/storage/indexes";
import { anyOwnerExists } from "@/lib/storage/repositories/accounts";
import { getSiteConfig } from "@/lib/storage/repositories/config";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // First-run: no owner yet → the setup screen is the front door.
  if (!(await anyOwnerExists())) redirect("/setup");

  const [account, index, config] = await Promise.all([
    getSessionAccount(),
    getSearchIndex(),
    getSiteConfig(),
  ]);
  const visible = index.entries
    .filter((e) => !e.archived)
    .filter((e) => canViewRecipe(e, config, account))
    .slice(0, 12);

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col items-center gap-4 py-8 text-center">
        <h1 className="font-display text-4xl font-bold">{config.siteName}</h1>
        <p className="max-w-xl text-muted-foreground">
          {account
            ? `Welcome back, ${account.displayName}.`
            : "Browse the public recipes, or sign in for the full collection."}
        </p>
        <SearchBox />
      </section>

      <section aria-label="Recent recipes">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-2xl font-semibold">Recent recipes</h2>
          <Link href="/recipes" className="text-sm text-accent hover:underline">
            Browse all →
          </Link>
        </div>
        {visible.length === 0 ? (
          <EmptyState title="No recipes yet">
            <p>{account?.type === "owner" ? "Create your first recipe from the admin area." : "The owner hasn't published any recipes you can view yet."}</p>
          </EmptyState>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((entry) => (
              <li key={entry.id}>
                <RecipeCard recipe={entry} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
