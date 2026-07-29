import { EMPTY_RECIPE, RecipeEditor } from "@/components/admin/RecipeEditor";

export const dynamic = "force-dynamic";
export const metadata = { title: "New recipe" };

export default function NewRecipePage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="font-display text-3xl font-bold">New recipe</h1>
      <RecipeEditor initial={EMPTY_RECIPE} />
    </div>
  );
}
