import { redirect } from "next/navigation";
import { Forbidden } from "@/components/Forbidden";
import { MealPlanner } from "@/components/meal-planner/MealPlanner";
import { getSessionAccount } from "@/lib/authorization/guards";
import { hasCapability } from "@/lib/authorization/capabilities";
import { canViewRecipe } from "@/lib/authorization/visibility";
import { getOwnMealPlan } from "@/lib/meal-plans/service";
import { resolveRecipeRefs } from "@/lib/recipes/service";
import { isoWeekId, weekLabel } from "@/lib/time";
import { assertWeekId } from "@/lib/ids";
import { getSearchIndex } from "@/lib/storage/indexes";
import { getSiteConfig } from "@/lib/storage/repositories/config";
import { MEAL_SLOTS } from "@/lib/validation/constants";

export const dynamic = "force-dynamic";
export const metadata = { title: "Meal Planner" };

interface Props {
  searchParams: Promise<{ week?: string }>;
}

export default async function MealPlannerPage({ searchParams }: Props) {
  const account = await getSessionAccount();
  if (!account) redirect("/login?callbackUrl=/meal-planner");
  if (!hasCapability(account, "mealPlans.use")) {
    return <Forbidden message="Your account doesn't include the meal planner capability." />;
  }

  const { week } = await searchParams;
  const weekId = week ? assertWeekId(week) : isoWeekId();
  const [plan, index, config] = await Promise.all([getOwnMealPlan(account, weekId), getSearchIndex(), getSiteConfig()]);

  const refs = await resolveRecipeRefs(
    plan.entries.map((e) => e.recipeId),
    account,
  );
  const availableRecipes = index.entries
    .filter((e) => !e.archived)
    .filter((e) => canViewRecipe(e, config, account))
    .map(({ id, slug, title }) => ({ id, slug, title }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Meal Planner</h1>
          <p className="text-sm text-muted-foreground">{weekLabel(weekId)}</p>
        </div>
      </div>
      <MealPlanner
        weekId={weekId}
        slots={[...MEAL_SLOTS]}
        entries={plan.entries.map((entry) => {
          const ref = refs.get(entry.recipeId);
          return {
            entryId: entry.id,
            day: entry.day,
            slot: entry.slot,
            note: entry.note,
            recipeId: entry.recipeId,
            title: ref?.title ?? "Unavailable recipe",
            slug: ref?.slug ?? "",
            tombstone: !ref || ref.archived || !ref.viewable,
          };
        })}
        availableRecipes={availableRecipes}
        canGenerateList={hasCapability(account, "shoppingLists.use")}
      />
    </div>
  );
}
