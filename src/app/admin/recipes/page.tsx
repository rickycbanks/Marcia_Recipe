import Link from "next/link";
import { listAllRecipesForOwner } from "@/lib/recipes/service";
import { RecipeAdminTable } from "@/components/admin/RecipeAdminTable";

export const dynamic = "force-dynamic";
export const metadata = { title: "Manage recipes" };

export default async function AdminRecipesPage() {
  const recipes = await listAllRecipesForOwner();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-3xl font-bold">Recipes</h1>
        <Link href="/admin/recipes/new" className="btn-primary">
          + New recipe
        </Link>
      </div>
      <RecipeAdminTable
        recipes={recipes.map((r) => ({
          id: r.id,
          slug: r.slug,
          title: r.title,
          visibility: r.visibility,
          category: r.category,
          archived: r.archivedAt !== null,
          mediaCount: r.media.length,
          primaryMediaId: r.media.find((m) => m.isPrimary)?.id ?? r.media[0]?.id ?? null,
          updatedAt: r.updatedAt,
        }))}
      />
    </div>
  );
}
