"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ImportPanel, type ImportedDraft } from "./ImportPanel";
import { MediaManager } from "./MediaManager";

export interface IngredientRow {
  quantity: string;
  unit: string;
  name: string;
  note: string;
}

export interface RecipeEditorInitial {
  id?: string;
  slug?: string;
  title: string;
  description: string;
  visibility: "inherit" | "public" | "members" | "owner";
  prepMinutes: string;
  cookMinutes: string;
  servings: string;
  difficulty: "" | "easy" | "medium" | "hard";
  category: string;
  tags: string;
  sourceUrl: string;
  ingredients: IngredientRow[];
  steps: string[];
  notesMarkdown: string;
  media: { id: string; alt: string; isPrimary: boolean }[];
}

export const EMPTY_RECIPE: RecipeEditorInitial = {
  title: "",
  description: "",
  visibility: "inherit",
  prepMinutes: "",
  cookMinutes: "",
  servings: "",
  difficulty: "",
  category: "",
  tags: "",
  sourceUrl: "",
  ingredients: [{ quantity: "", unit: "", name: "", note: "" }],
  steps: [""],
  notesMarkdown: "",
  media: [],
};

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function RecipeEditor({ initial }: { initial: RecipeEditorInitial }) {
  const router = useRouter();
  const isEdit = !!initial.id;
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof RecipeEditorInitial>(key: K, value: RecipeEditorInitial[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setIngredient = (index: number, key: keyof IngredientRow, value: string) =>
    setForm((f) => ({
      ...f,
      ingredients: f.ingredients.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    }));

  const moveIngredient = (index: number, delta: number) =>
    setForm((f) => {
      const target = index + delta;
      if (target < 0 || target >= f.ingredients.length) return f;
      const next = [...f.ingredients];
      const [row] = next.splice(index, 1);
      next.splice(target, 0, row!);
      return { ...f, ingredients: next };
    });

  const moveStep = (index: number, delta: number) =>
    setForm((f) => {
      const target = index + delta;
      if (target < 0 || target >= f.steps.length) return f;
      const next = [...f.steps];
      const [row] = next.splice(index, 1);
      next.splice(target, 0, row!);
      return { ...f, steps: next };
    });

  const applyImport = (draft: ImportedDraft) => {
    setForm((f) => ({
      ...f,
      title: draft.title || f.title,
      description: draft.description,
      prepMinutes: draft.prepMinutes !== null ? String(draft.prepMinutes) : "",
      cookMinutes: draft.cookMinutes !== null ? String(draft.cookMinutes) : "",
      servings: draft.servings !== null ? String(draft.servings) : "",
      category: draft.category ?? "",
      tags: draft.tags.join(", "),
      sourceUrl: draft.sourceUrl ?? "",
      ingredients:
        draft.ingredients.length > 0
          ? draft.ingredients.map((i) => ({
              quantity: i.quantity !== null ? String(i.quantity) : "",
              unit: i.unit ?? "",
              name: i.name,
              note: i.note ?? "",
            }))
          : f.ingredients,
      steps: draft.steps.length > 0 ? draft.steps : f.steps,
      notesMarkdown: draft.notesMarkdown,
    }));
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      ...(form.slug ? { slug: form.slug } : {}),
      title: form.title.trim(),
      description: form.description.trim(),
      visibility: form.visibility,
      prepMinutes: parseOptionalNumber(form.prepMinutes),
      cookMinutes: parseOptionalNumber(form.cookMinutes),
      servings: parseOptionalNumber(form.servings),
      difficulty: form.difficulty === "" ? null : form.difficulty,
      category: form.category.trim() || null,
      tags: form.tags
        .split(",")
        .map((t) => t.trim().replace(/^#/, ""))
        .filter(Boolean),
      sourceUrl: form.sourceUrl.trim() || null,
      ingredients: form.ingredients
        .filter((i) => i.name.trim())
        .map((i) => ({
          quantity: parseOptionalNumber(i.quantity),
          unit: i.unit.trim() || null,
          name: i.name.trim(),
          note: i.note.trim() || null,
        })),
      steps: form.steps.map((s) => s.trim()).filter(Boolean),
      notesMarkdown: form.notesMarkdown,
    };
    const response = await fetch(isEdit ? `/api/recipes/${initial.id}` : "/api/recipes", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Could not save the recipe.");
      return;
    }
    router.push("/admin/recipes");
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {!isEdit ? <ImportPanel onImport={applyImport} /> : null}

      <div className="card flex flex-col gap-4 p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="title" className="label">
              Title
            </label>
            <input id="title" className="input" required maxLength={200} value={form.title} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div>
            <label htmlFor="slug" className="label">
              Slug (optional — derived from title)
            </label>
            <input
              id="slug"
              className="input"
              maxLength={80}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              title="lowercase words separated by hyphens"
              value={form.slug ?? ""}
              onChange={(e) => set("slug", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="visibility" className="label">
              Visibility
            </label>
            <select id="visibility" className="input" value={form.visibility} onChange={(e) => set("visibility", e.target.value as RecipeEditorInitial["visibility"])}>
              <option value="inherit">Inherit site default</option>
              <option value="public">Public</option>
              <option value="members">Members (accounts with recipes.read)</option>
              <option value="owner">Owner only</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="description" className="label">
              Description
            </label>
            <textarea id="description" className="input" rows={2} maxLength={2000} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </div>
          <div>
            <label htmlFor="prep" className="label">
              Prep minutes
            </label>
            <input id="prep" className="input" type="number" min={0} value={form.prepMinutes} onChange={(e) => set("prepMinutes", e.target.value)} />
          </div>
          <div>
            <label htmlFor="cook" className="label">
              Cook minutes
            </label>
            <input id="cook" className="input" type="number" min={0} value={form.cookMinutes} onChange={(e) => set("cookMinutes", e.target.value)} />
          </div>
          <div>
            <label htmlFor="servings" className="label">
              Servings
            </label>
            <input id="servings" className="input" type="number" min={0} step="any" value={form.servings} onChange={(e) => set("servings", e.target.value)} />
          </div>
          <div>
            <label htmlFor="difficulty" className="label">
              Difficulty
            </label>
            <select id="difficulty" className="input" value={form.difficulty} onChange={(e) => set("difficulty", e.target.value as RecipeEditorInitial["difficulty"])}>
              <option value="">—</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
          <div>
            <label htmlFor="category" className="label">
              Category
            </label>
            <input id="category" className="input" maxLength={60} value={form.category} onChange={(e) => set("category", e.target.value)} />
          </div>
          <div>
            <label htmlFor="tags" className="label">
              Tags (comma separated)
            </label>
            <input id="tags" className="input" value={form.tags} onChange={(e) => set("tags", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="sourceUrl" className="label">
              Source URL
            </label>
            <input id="sourceUrl" className="input" type="url" value={form.sourceUrl} onChange={(e) => set("sourceUrl", e.target.value)} />
          </div>
        </div>
      </div>

      <fieldset className="card flex flex-col gap-3 p-6">
        <legend className="px-1 font-display text-lg font-semibold">Ingredients</legend>
        {form.ingredients.map((row, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <input
              className="input w-20"
              placeholder="Qty"
              aria-label={`Ingredient ${index + 1} quantity`}
              value={row.quantity}
              onChange={(e) => setIngredient(index, "quantity", e.target.value)}
            />
            <input
              className="input w-24"
              placeholder="Unit"
              aria-label={`Ingredient ${index + 1} unit`}
              value={row.unit}
              onChange={(e) => setIngredient(index, "unit", e.target.value)}
            />
            <input
              className="input min-w-40 flex-1"
              placeholder="Ingredient name"
              aria-label={`Ingredient ${index + 1} name`}
              value={row.name}
              onChange={(e) => setIngredient(index, "name", e.target.value)}
            />
            <input
              className="input w-36"
              placeholder="Note (optional)"
              aria-label={`Ingredient ${index + 1} note`}
              value={row.note}
              onChange={(e) => setIngredient(index, "note", e.target.value)}
            />
            <div className="flex gap-1">
              <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => moveIngredient(index, -1)} aria-label="Move up">
                ↑
              </button>
              <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => moveIngredient(index, 1)} aria-label="Move down">
                ↓
              </button>
              <button
                type="button"
                className="btn-secondary px-2 py-1 text-xs"
                onClick={() => set("ingredients", form.ingredients.filter((_, i) => i !== index))}
                aria-label="Remove ingredient"
              >
                ×
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="btn-secondary self-start"
          onClick={() => set("ingredients", [...form.ingredients, { quantity: "", unit: "", name: "", note: "" }])}
        >
          + Add ingredient
        </button>
      </fieldset>

      <fieldset className="card flex flex-col gap-3 p-6">
        <legend className="px-1 font-display text-lg font-semibold">Steps</legend>
        {form.steps.map((step, index) => (
          <div key={index} className="flex items-start gap-2">
            <span className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
              {index + 1}
            </span>
            <textarea
              className="input flex-1"
              rows={2}
              aria-label={`Step ${index + 1}`}
              value={step}
              onChange={(e) => set("steps", form.steps.map((s, i) => (i === index ? e.target.value : s)))}
            />
            <div className="flex gap-1">
              <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => moveStep(index, -1)} aria-label="Move up">
                ↑
              </button>
              <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => moveStep(index, 1)} aria-label="Move down">
                ↓
              </button>
              <button
                type="button"
                className="btn-secondary px-2 py-1 text-xs"
                onClick={() => set("steps", form.steps.filter((_, i) => i !== index))}
                aria-label="Remove step"
              >
                ×
              </button>
            </div>
          </div>
        ))}
        <button type="button" className="btn-secondary self-start" onClick={() => set("steps", [...form.steps, ""])}>
          + Add step
        </button>
      </fieldset>

      <div className="card flex flex-col gap-2 p-6">
        <label htmlFor="notes" className="label">
          Notes (Markdown — rendered with HTML stripped)
        </label>
        <textarea id="notes" className="input font-mono text-sm" rows={6} value={form.notesMarkdown} onChange={(e) => set("notesMarkdown", e.target.value)} />
      </div>

      {isEdit && initial.id ? <MediaManager recipeId={initial.id} media={form.media} /> : null}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex gap-3">
        <button type="submit" className="btn-primary" disabled={busy || !form.title.trim()}>
          {busy ? "Saving…" : isEdit ? "Save changes" : "Create recipe"}
        </button>
        <button type="button" className="btn-secondary" onClick={() => router.push("/admin/recipes")}>
          Cancel
        </button>
      </div>
    </form>
  );
}

