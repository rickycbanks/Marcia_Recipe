import { PassThrough, Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { apiHandler } from "@/lib/api";
import { requireOwner } from "@/lib/authorization/guards";
import { listAllAccounts } from "@/lib/accounts/service";
import { listRecipes } from "@/lib/storage/repositories/recipes";
import { listMealPlans, listShoppingLists } from "@/lib/storage/repositories/mealPlans";
import { mealPlanToMarkdown, recipeToMarkdown, shoppingListToMarkdown, type RecipeRef } from "@/lib/export/markdown";
import { slugify } from "@/lib/ids";
import type { Account, MealPlan, ShoppingList } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Compact YYYYMMDD-HHMMSS stamp for archive/filename use. */
function fileTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** Owner-only full-database Markdown export, streamed as a zip archive. */
export const GET = apiHandler(async () => {
  await requireOwner();

  const now = new Date();
  const stamp = fileTimestamp(now);
  const root = `marcia-export-${stamp}`;
  const filename = `${root}.zip`;

  const [recipes, accounts] = await Promise.all([listRecipes(), listAllAccounts()]);

  // Per-account private data (plans + lists) — the owner sees everything.
  const mealPlans: MealPlan[] = [];
  const shoppingLists: ShoppingList[] = [];
  for (const account of accounts) {
    mealPlans.push(...(await listMealPlans(account.id)));
    shoppingLists.push(...(await listShoppingLists(account.id)));
  }

  // Recipe lookup for meal-plan rendering (archived recipes become tombstones).
  const recipeRefs = new Map<string, RecipeRef>();
  for (const recipe of recipes) {
    recipeRefs.set(recipe.id, {
      id: recipe.id,
      title: recipe.title,
      slug: recipe.slug,
      archived: recipe.archivedAt !== null,
    });
  }
  const accountById = new Map<string, Account>(accounts.map((a) => [a.id, a]));
  const usernameFor = (accountId: string): string => accountById.get(accountId)?.username ?? accountId;

  const passthrough = new PassThrough();
  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.pipe(passthrough);

  for (const recipe of recipes) {
    archive.append(recipeToMarkdown(recipe), { name: `${root}/recipes/${recipe.slug}.md` });
  }
  for (const plan of mealPlans) {
    archive.append(mealPlanToMarkdown(plan, recipeRefs), {
      name: `${root}/meal-plans/${usernameFor(plan.accountId)}-${plan.weekId}.md`,
    });
  }
  for (const list of shoppingLists) {
    archive.append(shoppingListToMarkdown(list), {
      name: `${root}/shopping-lists/${usernameFor(list.accountId)}-${slugify(list.name)}.md`,
    });
  }
  archive.append(
    [
      "# Marcia Recipe Export",
      "",
      `Generated: ${now.toISOString()}`,
      `Recipes: ${recipes.length}`,
      `Meal plans: ${mealPlans.length}`,
      `Shopping lists: ${shoppingLists.length}`,
      "",
    ].join("\n"),
    { name: `${root}/README.md` },
  );

  const stream = Readable.toWeb(passthrough) as ReadableStream;
  const response = new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });

  await archive.finalize();
  return response;
});
