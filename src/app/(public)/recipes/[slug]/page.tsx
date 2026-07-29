import { notFound, permanentRedirect } from "next/navigation";
import { MarkdownView } from "@/components/MarkdownView";
import { getSessionAccount } from "@/lib/authorization/guards";
import { resolveVisibility } from "@/lib/authorization/visibility";
import { getVisibleRecipeBySlug } from "@/lib/recipes/service";
import { getSiteConfig } from "@/lib/storage/repositories/config";
import { formatQuantity } from "@/lib/shopping-lists/aggregate";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const account = await getSessionAccount();
  const resolved = await getVisibleRecipeBySlug(slug, account);
  if (!resolved) return { title: "Recipe not found" };
  return { title: resolved.recipe.title, description: resolved.recipe.description || undefined };
}

export default async function RecipeDetailPage({ params }: Props) {
  const { slug } = await params;
  const [account, config] = await Promise.all([getSessionAccount(), getSiteConfig()]);
  const resolved = await getVisibleRecipeBySlug(slug, account);
  if (!resolved) notFound(); // restricted recipes behave exactly like missing ones
  const { recipe, viaAlias } = resolved;
  if (viaAlias) permanentRedirect(`/recipes/${recipe.slug}`);

  const totalMinutes = (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0) || null;
  const primary = recipe.media.find((m) => m.isPrimary) ?? recipe.media[0];

  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {recipe.category ? <span className="badge">{recipe.category}</span> : null}
          {recipe.tags.map((t) => (
            <span key={t} className="badge">
              #{t}
            </span>
          ))}
          {resolveVisibility(recipe, config) !== "public" && account?.type === "owner" ? (
            <span className="badge">visibility: {resolveVisibility(recipe, config)}</span>
          ) : null}
        </div>
        <h1 className="font-display text-4xl font-bold leading-tight">{recipe.title}</h1>
        {recipe.description ? <p className="text-lg text-muted-foreground">{recipe.description}</p> : null}
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          {recipe.prepMinutes !== null ? (
            <div className="flex gap-1">
              <dt className="font-medium">Prep:</dt>
              <dd>{recipe.prepMinutes} min</dd>
            </div>
          ) : null}
          {recipe.cookMinutes !== null ? (
            <div className="flex gap-1">
              <dt className="font-medium">Cook:</dt>
              <dd>{recipe.cookMinutes} min</dd>
            </div>
          ) : null}
          {totalMinutes !== null ? (
            <div className="flex gap-1">
              <dt className="font-medium">Total:</dt>
              <dd>{totalMinutes} min</dd>
            </div>
          ) : null}
          {recipe.servings !== null ? (
            <div className="flex gap-1">
              <dt className="font-medium">Servings:</dt>
              <dd>{formatQuantity(recipe.servings)}</dd>
            </div>
          ) : null}
          {recipe.difficulty ? (
            <div className="flex gap-1">
              <dt className="font-medium">Difficulty:</dt>
              <dd className="capitalize">{recipe.difficulty}</dd>
            </div>
          ) : null}
        </dl>
      </header>

      {primary ? (
        // Media is served through the authorized route.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/media/${recipe.id}/${primary.id}`}
          alt={primary.alt || recipe.title}
          className="w-full rounded-xl border border-border object-cover"
        />
      ) : null}

      {recipe.media.length > 1 ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {recipe.media
            .filter((m) => m.id !== primary?.id)
            .map((m) => (
              <li key={m.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/media/${recipe.id}/${m.id}`}
                  alt={m.alt}
                  loading="lazy"
                  className="h-24 w-full rounded-lg border border-border object-cover"
                />
              </li>
            ))}
        </ul>
      ) : null}

      <section aria-label="Ingredients" className="card p-6">
        <h2 className="mb-3 font-display text-2xl font-semibold">Ingredients</h2>
        <ul className="flex flex-col gap-1.5">
          {[...recipe.ingredients]
            .sort((a, b) => a.order - b.order)
            .map((ingredient) => (
              <li key={ingredient.id} className="flex gap-2 text-sm">
                <span aria-hidden className="text-accent">•</span>
                <span>
                  {ingredient.quantity !== null ? <strong>{formatQuantity(ingredient.quantity)}</strong> : null}
                  {ingredient.unit ? ` ${ingredient.unit}` : null}
                  {ingredient.quantity !== null || ingredient.unit ? " " : ""}
                  {ingredient.name}
                  {ingredient.note ? <span className="text-muted-foreground">, {ingredient.note}</span> : null}
                </span>
              </li>
            ))}
        </ul>
      </section>

      <section aria-label="Instructions">
        <h2 className="mb-3 font-display text-2xl font-semibold">Instructions</h2>
        <ol className="flex flex-col gap-4">
          {[...recipe.steps]
            .sort((a, b) => a.order - b.order)
            .map((step, i) => (
              <li key={step.id} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
                  {i + 1}
                </span>
                <p className="pt-0.5 text-sm leading-relaxed">{step.text}</p>
              </li>
            ))}
        </ol>
      </section>

      {recipe.notesMarkdown.trim() ? (
        <section aria-label="Notes" className="card p-6">
          <h2 className="mb-3 font-display text-2xl font-semibold">Notes</h2>
          <MarkdownView markdown={recipe.notesMarkdown} />
        </section>
      ) : null}

      {recipe.sourceUrl ? (
        <p className="text-sm text-muted-foreground">
          Source:{" "}
          <a href={recipe.sourceUrl} rel="noopener noreferrer nofollow" className="text-accent hover:underline">
            {new URL(recipe.sourceUrl).hostname}
          </a>
        </p>
      ) : null}
    </article>
  );
}
