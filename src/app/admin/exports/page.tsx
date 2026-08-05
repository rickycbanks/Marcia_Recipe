import { listAllRecipesForOwner } from "@/lib/recipes/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Exports" };

export default async function AdminExportsPage() {
  const recipes = await listAllRecipesForOwner();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-bold">Exports</h1>
      <div className="card flex flex-col gap-4 p-6">
        <h2 className="font-display text-xl font-semibold">Export everything as Markdown</h2>
        <p className="text-sm text-muted-foreground">
          Download all recipes, meal plans, and shopping lists as a single zip archive of Markdown files.
          Each recipe, meal plan, and shopping list becomes its own <code>.md</code> file, readable in any
          text editor or Markdown viewer.
        </p>
        <ul className="text-sm text-muted-foreground">
          <li>Recipes: {recipes.length} (all, including archived)</li>
          <li>Meal plans and shopping lists: all accounts</li>
        </ul>
        <a href="/api/admin/export-all" className="btn-primary self-start">
          Download full export (.zip)
        </a>
      </div>
    </div>
  );
}
