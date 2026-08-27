/**
 * Markdown export serializers. These are *presentation* converters — they turn
 * validated domain objects into human-readable Markdown for download. They are
 * NOT used for storage (storage remains JSON); they exist only for the export
 * feature so guests and the owner can download a recipe, meal plan, shopping
 * list, or the whole database as Markdown.
 *
 * Output is plain CommonMark: headings, bullet lists, ordered lists, and
 * blockquotes. No frontmatter, no YAML — just readable prose that opens in any
 * Markdown viewer or text editor.
 */
import type { MealPlan, Recipe, ShoppingList } from "@/types";
import { formatQuantity } from "@/lib/fractions";

/* --------------------------------- recipe --------------------------------- */

function formatIngredientLine(ing: Recipe["ingredients"][number]): string {
  const parts: string[] = [];
  const q = ing.quantity !== null ? formatQuantity(ing.quantity) : "";
  if (q) parts.push(q);
  if (ing.unit) parts.push(ing.unit);
  if (ing.name) parts.push(ing.name);
  let line = parts.join(" ").trim();
  if (ing.note) line += ` — ${ing.note}`;
  return line || ing.name;
}

function difficultyLabel(d: "easy" | "medium" | "hard"): string {
  return d.charAt(0).toUpperCase() + d.slice(1);
}

function formatMinutes(m: number | null): string {
  return m === null ? "" : `${m} min`;
}

/**
 * Serialize a recipe to a standalone Markdown document. The title is the h1;
 * metadata is a bullet list; ingredients, steps, and notes are sections.
 */
export function recipeToMarkdown(recipe: Recipe): string {
  const lines: string[] = [];
  lines.push(`# ${recipe.title}`, "");

  if (recipe.description) {
    lines.push(`> ${recipe.description}`, "");
  }

  const meta: string[] = [];
  const prep = formatMinutes(recipe.prepMinutes);
  const cook = formatMinutes(recipe.cookMinutes);
  if (prep && cook) meta.push(`**Prep:** ${prep}`, `**Cook:** ${cook}`, `**Total:** ${(recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0)} min`);
  else if (prep) meta.push(`**Prep:** ${prep}`);
  else if (cook) meta.push(`**Cook:** ${cook}`);
  if (recipe.servings !== null) meta.push(`**Servings:** ${formatQuantity(recipe.servings)}`);
  if (recipe.difficulty) meta.push(`**Difficulty:** ${difficultyLabel(recipe.difficulty)}`);
  if (recipe.category) meta.push(`**Category:** ${recipe.category}`);
  if (recipe.tags.length > 0) meta.push(`**Tags:** ${recipe.tags.join(", ")}`);
  if (recipe.sourceUrl) meta.push(`**Source:** ${recipe.sourceUrl}`);
  if (recipe.bookTitle || recipe.bookAuthor || recipe.bookPage !== null) {
    const bookParts = [recipe.bookTitle, recipe.bookAuthor, recipe.bookPage !== null ? `p. ${recipe.bookPage}` : null]
      .filter((part): part is string => !!part);
    meta.push(`**Book:** ${bookParts.join(" · ")}`);
  }
  if (meta.length > 0) {
    lines.push(...meta.map((m) => `- ${m}`), "");
  }

  if (recipe.ingredients.length > 0) {
    lines.push("## Ingredients", "");
    for (const ing of recipe.ingredients) {
      lines.push(`- ${formatIngredientLine(ing)}`);
    }
    lines.push("");
  }

  if (recipe.steps.length > 0) {
    lines.push("## Steps", "");
    for (const step of recipe.steps) {
      lines.push(`${step.order + 1}. ${step.text}`);
    }
    lines.push("");
  }

  if (recipe.notesMarkdown.trim()) {
    lines.push("## Notes", "");
    lines.push(recipe.notesMarkdown.trim(), "");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/* -------------------------------- meal plan ------------------------------- */

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Minimal recipe reference needed to render a meal-plan entry. */
export interface RecipeRef {
  id: string;
  title: string;
  slug: string;
  archived?: boolean;
}

/**
 * Serialize a meal plan to Markdown. Entries are grouped by day, then by slot.
 * `recipeRefs` maps recipeId → { title, slug } so recipe titles can be shown;
 * missing recipes (e.g. archived/removed) render as plain text tombstones.
 */
export function mealPlanToMarkdown(plan: MealPlan, recipeRefs: Map<string, RecipeRef>): string {
  const lines: string[] = [];
  lines.push(`# Meal Plan — ${plan.weekId}`, "");

  // Group entries by day (0-6) then by slot.
  const byDay = new Map<number, MealPlan["entries"][number][]>();
  for (const entry of plan.entries) {
    const arr = byDay.get(entry.day) ?? [];
    arr.push(entry);
    byDay.set(entry.day, arr);
  }

  const days = [...byDay.keys()].sort((a, b) => a - b);
  for (const day of days) {
    const entries = byDay.get(day)!;
    // Sort within a day by slot order: breakfast, lunch, dinner, snack.
    const slotOrder = ["breakfast", "lunch", "dinner", "snack"];
    entries.sort((a, b) => slotOrder.indexOf(a.slot) - slotOrder.indexOf(b.slot));

    lines.push(`## ${DAY_NAMES[day] ?? `Day ${day + 1}`}`, "");
    for (const entry of entries) {
      const slotLabel = entry.slot.charAt(0).toUpperCase() + entry.slot.slice(1);
      lines.push(`### ${slotLabel}`, "");
      const ref = recipeRefs.get(entry.recipeId);
      if (ref) {
        const link = ref.archived ? `${ref.title} (archived)` : `[${ref.title}](/recipes/${ref.slug})`;
        lines.push(`- ${link}`);
      } else {
        lines.push(`- *(recipe removed)*`);
      }
      if (entry.note) lines.push(`  - ${entry.note}`);
      lines.push("");
    }
  }

  if (plan.entries.length === 0) {
    lines.push("*(No meals planned for this week.)*", "");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/* ------------------------------- shopping list ----------------------------- */

/**
 * Serialize a shopping list to Markdown. Unchecked items use `- [ ]`, checked
 * items use `- [x]`. Generated items attribute their source recipe in italics.
 */
export function shoppingListToMarkdown(list: ShoppingList): string {
  const lines: string[] = [];
  lines.push(`# ${list.name}`, "");

  if (list.items.length === 0) {
    lines.push("*(Empty list.)*", "");
    return lines.join("\n").trim() + "\n";
  }

  // Group by checked/unchecked for readability.
  const unchecked = list.items.filter((i) => !i.checked);
  const checked = list.items.filter((i) => i.checked);

  if (unchecked.length > 0) {
    lines.push("## To buy", "");
    for (const item of unchecked) {
      lines.push(`- ${formatShoppingItem(item)}`);
    }
    lines.push("");
  }

  if (checked.length > 0) {
    lines.push("## Done", "");
    for (const item of checked) {
      lines.push(`- ${formatShoppingItem(item)}`);
    }
    lines.push("");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function formatShoppingItem(item: ShoppingList["items"][number]): string {
  const parts: string[] = [];
  const q = item.quantity !== null ? formatQuantity(item.quantity) : "";
  if (q) parts.push(q);
  if (item.unit) parts.push(item.unit);
  let line = parts.join(" ").trim();
  if (line) line += ` ${item.text}`;
  else line = item.text;
  if (item.recipeTitle) line += ` *(${item.recipeTitle})*`;
  return `[${item.checked ? "x" : " "}] ${line}`.replace(/^\[[ x]\] /, item.checked ? "- [x] " : "- [ ] ");
}