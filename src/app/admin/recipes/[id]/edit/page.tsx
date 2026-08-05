import { notFound } from "next/navigation";
import { RecipeEditor } from "@/components/admin/RecipeEditor";
import { getRecipeForOwner } from "@/lib/recipes/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit recipe" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditRecipePage({ params }: Props) {
  const { id } = await params;
  const recipe = await getRecipeForOwner(id).catch(() => null);
  if (!recipe) notFound();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="font-display text-3xl font-bold">Edit recipe</h1>
      <RecipeEditor
        initial={{
          id: recipe.id,
          slug: recipe.slug,
          title: recipe.title,
          description: recipe.description,
          visibility: recipe.visibility,
          prepMinutes: recipe.prepMinutes !== null ? String(recipe.prepMinutes) : "",
          cookMinutes: recipe.cookMinutes !== null ? String(recipe.cookMinutes) : "",
          servings: recipe.servings !== null ? String(recipe.servings) : "",
          difficulty: recipe.difficulty ?? "",
          category: recipe.category ?? "",
          tags: recipe.tags.join(", "),
          sourceUrl: recipe.sourceUrl ?? "",
          bookTitle: recipe.bookTitle ?? "",
          bookAuthor: recipe.bookAuthor ?? "",
          bookPage: recipe.bookPage !== null ? String(recipe.bookPage) : "",
          ingredients:
            recipe.ingredients.length > 0
              ? [...recipe.ingredients]
                  .sort((a, b) => a.order - b.order)
                  .map((i) => ({
                    quantity: i.quantity !== null ? String(i.quantity) : "",
                    unit: i.unit ?? "",
                    name: i.name,
                    note: i.note ?? "",
                  }))
              : [{ quantity: "", unit: "", name: "", note: "" }],
          steps: recipe.steps.length > 0 ? [...recipe.steps].sort((a, b) => a.order - b.order).map((s) => s.text) : [""],
          notesMarkdown: recipe.notesMarkdown,
          media: recipe.media.map((m) => ({ id: m.id, alt: m.alt, isPrimary: m.isPrimary })),
        }}
      />
    </div>
  );
}
