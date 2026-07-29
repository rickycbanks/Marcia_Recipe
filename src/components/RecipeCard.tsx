import Link from "next/link";

export interface RecipeCardData {
  slug: string;
  title: string;
  description: string;
  category: string | null;
  tags: string[];
  primaryMediaId: string | null;
  id: string;
}

export function RecipeCard({ recipe }: { recipe: RecipeCardData }) {
  return (
    <Link
      href={`/recipes/${recipe.slug}`}
      className="card group flex flex-col overflow-hidden transition-shadow hover:shadow-md"
    >
      {recipe.primaryMediaId ? (
        // Media is served through the authorized route; public recipes allow public caching.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/media/${recipe.id}/${recipe.primaryMediaId}`}
          alt=""
          loading="lazy"
          className="h-40 w-full object-cover"
        />
      ) : (
        <div className="flex h-40 w-full items-center justify-center bg-muted text-4xl" aria-hidden>
          🍽️
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="font-display text-lg font-semibold leading-snug group-hover:underline">
          {recipe.title}
        </h3>
        {recipe.description ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">{recipe.description}</p>
        ) : null}
        <div className="mt-auto flex flex-wrap gap-1 pt-1">
          {recipe.category ? <span className="badge">{recipe.category}</span> : null}
          {recipe.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="badge">
              #{tag}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}
