"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { recipeDraftSchema } from "@/lib/validation/schemas";
import { MAX_TAGS } from "@/lib/validation/constants";
import { AutocompleteInput } from "@/components/AutocompleteInput";
import { TagInput } from "@/components/TagInput";
import { ImportPanel, type ImportedDraft } from "./ImportPanel";
import { MediaManager } from "./MediaManager";
import { StagedMediaManager, type StagedMediaItem } from "./StagedMediaManager";

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
  tags: string[];
  sourceUrl: string;
  bookTitle: string;
  bookAuthor: string;
  bookPage: string;
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
  tags: [],
  sourceUrl: "",
  bookTitle: "",
  bookAuthor: "",
  bookPage: "",
  ingredients: [
    { quantity: "", unit: "", name: "", note: "" },
    { quantity: "", unit: "", name: "", note: "" },
    { quantity: "", unit: "", name: "", note: "" },
  ],
  steps: ["", ""],
  notesMarkdown: "",
  media: [],
};

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function isBlankIngredient(row: IngredientRow): boolean {
  return !row.quantity.trim() && !row.unit.trim() && !row.name.trim() && !row.note.trim();
}

function isBlankStep(step: string): boolean {
  return !step.trim();
}

export function RecipeEditor({ initial }: { initial: RecipeEditorInitial }) {
  const router = useRouter();
  const isEdit = !!initial.id;
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [stagedMedia, setStagedMedia] = useState<StagedMediaItem[]>([]);
  const [draggedIngredient, setDraggedIngredient] = useState<number | null>(null);
  const [dragOverIngredient, setDragOverIngredient] = useState<number | null>(null);
  const [draggedStep, setDraggedStep] = useState<number | null>(null);
  const [dragOverStep, setDragOverStep] = useState<number | null>(null);
  const ingredientRefs = useRef<(HTMLInputElement | null)[]>([]);
  const stepRefs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const priorSuggestionsRef = useRef<{
    categories: string[];
    tags: string[];
    bookTitles: string[];
    bookAuthors: string[];
  } | null>(null);
  const [suggestions, setSuggestions] = useState<{
    categories: string[];
    tags: string[];
    bookTitles: string[];
    bookAuthors: string[];
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/suggestion-index", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && !controller.signal.aborted) {
          const next = {
            categories: data.categories ?? [],
            tags: data.tags ?? [],
            bookTitles: data.bookTitles ?? [],
            bookAuthors: data.bookAuthors ?? [],
          };
          priorSuggestionsRef.current = next;
          setSuggestions(next);
        }
      })
      .catch(() => {
        /* autocomplete is best-effort */
      });
    return () => controller.abort();
  }, []);

  const set = <K extends keyof RecipeEditorInitial>(key: K, value: RecipeEditorInitial[K]) => {
    setDirty(true);
    setForm((f) => ({ ...f, [key]: value }));
  };

  const setIngredient = (index: number, key: keyof IngredientRow, value: string) => {
    setDirty(true);
    setForm((f) => ({
      ...f,
      ingredients: f.ingredients.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    }));
  };

  const totalMinutes = useMemo(() => {
    const prep = parseOptionalNumber(form.prepMinutes);
    const cook = parseOptionalNumber(form.cookMinutes);
    if (prep === null && cook === null) return null;
    return (prep ?? 0) + (cook ?? 0);
  }, [form.prepMinutes, form.cookMinutes]);

  const addIngredientRow = () => {
    setDirty(true);
    setForm((f) => ({ ...f, ingredients: [...f.ingredients, { quantity: "", unit: "", name: "", note: "" }] }));
  };

  const addStepRow = () => {
    setDirty(true);
    setForm((f) => ({ ...f, steps: [...f.steps, ""] }));
  };

  const removeIngredient = (index: number) => {
    setDirty(true);
    setForm((f) => ({
      ...f,
      ingredients: f.ingredients.length > 1 ? f.ingredients.filter((_, i) => i !== index) : f.ingredients,
    }));
  };

  const removeStep = (index: number) => {
    setDirty(true);
    setForm((f) => ({ ...f, steps: f.steps.length > 1 ? f.steps.filter((_, i) => i !== index) : f.steps }));
  };

  const moveIngredient = (index: number, target: number) => {
    if (target < 0 || target >= form.ingredients.length) return;
    setDirty(true);
    setForm((f) => {
      const next = [...f.ingredients];
      const [row] = next.splice(index, 1);
      next.splice(target, 0, row!);
      return { ...f, ingredients: next };
    });
  };

  const moveStep = (index: number, target: number) => {
    if (target < 0 || target >= form.steps.length) return;
    setDirty(true);
    setForm((f) => {
      const next = [...f.steps];
      const [row] = next.splice(index, 1);
      next.splice(target, 0, row!);
      return { ...f, steps: next };
    });
  };

  const applyImport = (draft: ImportedDraft) => {
    setDirty(true);
    setForm((f) => ({
      ...f,
      title: draft.title || f.title,
      description: draft.description,
      prepMinutes: draft.prepMinutes !== null ? String(draft.prepMinutes) : "",
      cookMinutes: draft.cookMinutes !== null ? String(draft.cookMinutes) : "",
      servings: draft.servings !== null ? String(draft.servings) : "",
      category: draft.category ?? "",
      tags: draft.tags,
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

  const buildPayload = () => ({
    ...(form.slug ? { slug: form.slug.trim() } : {}),
    title: form.title.trim(),
    description: form.description.trim(),
    visibility: form.visibility,
    prepMinutes: parseOptionalNumber(form.prepMinutes),
    cookMinutes: parseOptionalNumber(form.cookMinutes),
    servings: parseOptionalNumber(form.servings),
    difficulty: form.difficulty === "" ? null : form.difficulty,
    category: form.category.trim() || null,
    tags: form.tags
      .map((t) => t.trim().replace(/^#/, ""))
      .filter(Boolean),
    sourceUrl: form.sourceUrl.trim() || null,
    bookTitle: form.bookTitle.trim() || null,
    bookAuthor: form.bookAuthor.trim() || null,
    bookPage: parseOptionalNumber(form.bookPage),
    ingredients: form.ingredients
      .filter((i) => !isBlankIngredient(i))
      .map((i) => ({
        quantity: parseOptionalNumber(i.quantity),
        unit: i.unit.trim() || null,
        name: i.name.trim(),
        note: i.note.trim() || null,
      })),
    steps: form.steps.filter((s) => !isBlankStep(s)).map((s) => s.trim()),
    notesMarkdown: form.notesMarkdown.trim(),
    ...(!isEdit ? { stagedMedia: stagedMedia.map((media) => media.id) } : {}),
  });

  const validateClient = (): boolean => {
    const payload = buildPayload();
    const result = recipeDraftSchema.safeParse(payload);
    if (!result.success) {
      const errors: Record<string, string> = {};
      let firstMessage: string | null = null;
      for (const issue of result.error.issues) {
        const path = issue.path.join(".");
        if (!errors[path]) errors[path] = issue.message;
        if (!firstMessage) firstMessage = issue.message;
      }
      setFieldErrors(errors);
      setTopError(firstMessage ?? "Please fix the highlighted fields before saving.");
      return false;
    }
    setFieldErrors({});
    setTopError(null);
    return true;
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validateClient()) return;
    setBusy(true);
    setTopError(null);
    const payload = buildPayload();
    const response = await fetch(isEdit ? `/api/recipes/${initial.id}` : "/api/recipes", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setTopError(body?.error ?? "Could not save the recipe.");
      return;
    }
    // Optimistically merge newly-entered values into the local suggestion
    // state so the next editor open instantly suggests them.
    setSuggestions((prev) => {
      if (!prev) return prev;
      const merge = (existing: string[], incoming: string[]) => {
        const merged = new Set(existing.map((v) => v.toLowerCase()));
        const result = [...existing];
        for (const v of incoming) {
          const key = v.trim().toLowerCase();
          if (key && !merged.has(key)) {
            merged.add(key);
            result.push(v.trim());
          }
        }
        return result.sort((a, b) => a.localeCompare(b));
      };
      const cat = form.category.trim();
      const bookT = form.bookTitle.trim();
      const bookA = form.bookAuthor.trim();
      return {
        categories: cat ? merge(prev.categories, [cat]) : prev.categories,
        tags: merge(prev.tags, form.tags),
        bookTitles: bookT ? merge(prev.bookTitles, [bookT]) : prev.bookTitles,
        bookAuthors: bookA ? merge(prev.bookAuthors, [bookA]) : prev.bookAuthors,
      };
    });
    if (!isEdit) {
      const created = (await response.json()) as { id?: string };
      if (created.id) {
        router.push(`/admin/recipes/${created.id}/edit#photos`);
        router.refresh();
        return;
      }
    }
    router.push("/admin/recipes");
    router.refresh();
  };

  const onCancel = () => {
    if (!dirty || window.confirm("You have unsaved changes. Discard them?")) {
      router.push("/admin/recipes");
    }
  };

  const fieldError = (path: string) => fieldErrors[path] ?? null;
  const errorId = (path: string) => (fieldError(path) ? `error-${path.replace(/\./g, "-")}` : undefined);

  const handleIngredientKeyDown = (index: number, key: "quantity" | "unit" | "name" | "note", event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Tab" || event.shiftKey) return;
    const isLastField = index === form.ingredients.length - 1 && key === "note";
    if (!isLastField) return;
    const row = form.ingredients[index];
    if (!row || isBlankIngredient(row)) return;
    event.preventDefault();
    addIngredientRow();
    const nextIndex = form.ingredients.length;
    setTimeout(() => ingredientRefs.current[nextIndex]?.focus(), 0);
  };

  useEffect(() => {
    ingredientRefs.current = ingredientRefs.current.slice(0, form.ingredients.length);
  }, [form.ingredients.length]);

  useEffect(() => {
    stepRefs.current = stepRefs.current.slice(0, form.steps.length);
  }, [form.steps.length]);

  const renderFieldError = (path: string) => {
    const message = fieldError(path);
    if (!message) return null;
    return (
      <p className="help-text mt-1 text-danger" id={`error-${path.replace(/\./g, "-")}`}>
        {message}
      </p>
    );
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {!isEdit ? (
        <ImportPanel onImport={applyImport} />
      ) : null}

      {topError ? (
        <div role="alert" className="card border-l-4 border-l-danger p-4">
          <p className="text-sm font-medium text-danger">{topError}</p>
        </div>
      ) : null}

      <div className="card flex flex-col gap-6 p-6">
        {/* Basics */}
        <div className="flex flex-col gap-4">
          <h2 className="section-heading">Basics</h2>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label htmlFor="title" className="label">
                Title
              </label>
              <input
                id="title"
                className="input"
                required
                maxLength={200}
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                aria-invalid={!!fieldError("title")}
                aria-describedby={errorId("title")}
              />
              {renderFieldError("title")}
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
                aria-invalid={!!fieldError("slug")}
                aria-describedby={errorId("slug")}
              />
              {renderFieldError("slug")}
            </div>
            <div>
              <label htmlFor="description" className="label">
                Description
              </label>
              <textarea
                id="description"
                className="input"
                rows={3}
                maxLength={2000}
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                aria-invalid={!!fieldError("description")}
                aria-describedby={errorId("description")}
              />
              {renderFieldError("description")}
            </div>
          </div>
        </div>

        <hr className="border-border" />

        {/* Timing & yield */}
        <div className="flex flex-col gap-4">
          <h2 className="section-heading">Timing & yield</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="prep" className="label">
                Prep minutes
              </label>
              <input
                id="prep"
                className="input"
                type="number"
                min={0}
                value={form.prepMinutes}
                onChange={(e) => set("prepMinutes", e.target.value)}
                aria-invalid={!!fieldError("prepMinutes")}
                aria-describedby={errorId("prepMinutes")}
              />
              {renderFieldError("prepMinutes")}
            </div>
            <div>
              <label htmlFor="cook" className="label">
                Cook minutes
              </label>
              <input
                id="cook"
                className="input"
                type="number"
                min={0}
                value={form.cookMinutes}
                onChange={(e) => set("cookMinutes", e.target.value)}
                aria-invalid={!!fieldError("cookMinutes")}
                aria-describedby={errorId("cookMinutes")}
              />
              {renderFieldError("cookMinutes")}
            </div>
            <div>
              <label htmlFor="total" className="label">
                Total time
              </label>
              <div
                id="total"
                className="input flex items-center text-muted-foreground"
                aria-live="polite"
              >
                {totalMinutes !== null ? `${totalMinutes} min` : "—"}
              </div>
            </div>
            <div>
              <label htmlFor="servings" className="label">
                Servings
              </label>
              <input
                id="servings"
                className="input"
                type="number"
                min={0}
                step="any"
                value={form.servings}
                onChange={(e) => set("servings", e.target.value)}
                aria-invalid={!!fieldError("servings")}
                aria-describedby={errorId("servings")}
              />
              {renderFieldError("servings")}
            </div>
            <div>
              <label htmlFor="difficulty" className="label">
                Difficulty
              </label>
              <select
                id="difficulty"
                className="input"
                value={form.difficulty}
                onChange={(e) => set("difficulty", e.target.value as RecipeEditorInitial["difficulty"])}
                aria-invalid={!!fieldError("difficulty")}
                aria-describedby={errorId("difficulty")}
              >
                <option value="">—</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
              {renderFieldError("difficulty")}
            </div>
          </div>
        </div>

        <hr className="border-border" />

        {/* Organization */}
        <div className="flex flex-col gap-4">
          <h2 className="section-heading">Organization</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="category" className="label">
                Category
              </label>
              <AutocompleteInput
                id="category"
                value={form.category}
                onChange={(v) => set("category", v)}
                suggestions={suggestions?.categories ?? []}
                maxLength={60}
                placeholder="e.g., Dinner, Dessert, Bread"
                aria-invalid={!!fieldError("category")}
                aria-describedby={errorId("category")}
              />
              {renderFieldError("category")}
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="tags" className="label">
                Tags
              </label>
              <TagInput
                id="tags"
                value={form.tags}
                onChange={(t) => set("tags", t)}
                suggestions={suggestions?.tags ?? []}
                maxTags={MAX_TAGS}
                aria-invalid={!!fieldError("tags")}
                aria-describedby={errorId("tags")}
              />
              {renderFieldError("tags")}
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="visibility" className="label">
                Visibility
              </label>
              <select
                id="visibility"
                className="input"
                value={form.visibility}
                onChange={(e) => set("visibility", e.target.value as RecipeEditorInitial["visibility"])}
              >
                <option value="inherit">Inherit site default</option>
                <option value="public">Public</option>
                <option value="members">Members (accounts with recipes.read)</option>
                <option value="owner">Owner only</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="sourceUrl" className="label">
                Source URL
              </label>
              <input
                id="sourceUrl"
                className="input"
                type="url"
                placeholder="https://example.com/recipe"
                value={form.sourceUrl}
                onChange={(e) => set("sourceUrl", e.target.value)}
                aria-invalid={!!fieldError("sourceUrl")}
                aria-describedby={errorId("sourceUrl")}
              />
              {renderFieldError("sourceUrl")}
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="bookTitle" className="label">
                Book title
              </label>
              <AutocompleteInput
                id="bookTitle"
                value={form.bookTitle}
                onChange={(v) => set("bookTitle", v)}
                suggestions={suggestions?.bookTitles ?? []}
                maxLength={200}
                placeholder="e.g., The Joy of Cooking"
                aria-invalid={!!fieldError("bookTitle")}
                aria-describedby={errorId("bookTitle")}
              />
              {renderFieldError("bookTitle")}
            </div>
            <div>
              <label htmlFor="bookAuthor" className="label">
                Book author
              </label>
              <AutocompleteInput
                id="bookAuthor"
                value={form.bookAuthor}
                onChange={(v) => set("bookAuthor", v)}
                suggestions={suggestions?.bookAuthors ?? []}
                maxLength={120}
                placeholder="e.g., Rombauer & Becker"
                aria-invalid={!!fieldError("bookAuthor")}
                aria-describedby={errorId("bookAuthor")}
              />
              {renderFieldError("bookAuthor")}
            </div>
            <div>
              <label htmlFor="bookPage" className="label">
                Book page
              </label>
              <input
                id="bookPage"
                className="input"
                type="number"
                min={1}
                value={form.bookPage}
                onChange={(e) => set("bookPage", e.target.value)}
                aria-invalid={!!fieldError("bookPage")}
                aria-describedby={errorId("bookPage")}
              />
              {renderFieldError("bookPage")}
            </div>
          </div>
        </div>
      </div>

      <fieldset className="card flex flex-col gap-3 p-6">
        <legend className="px-1 font-display text-lg font-semibold">Ingredients</legend>
        {form.ingredients.map((row, index) => (
          <div
            key={index}
            className={`flex flex-wrap items-start gap-2 rounded-lg border border-dashed p-2 transition-colors ${
              dragOverIngredient === index ? "border-accent bg-muted/50" : "border-transparent"
            } ${draggedIngredient === index ? "opacity-50" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverIngredient(index);
            }}
            onDragLeave={() => setDragOverIngredient(null)}
            onDrop={(e) => {
              e.preventDefault();
              const from = Number(e.dataTransfer.getData("text/plain"));
              if (!Number.isNaN(from) && from !== index) {
                moveIngredient(from, index);
              }
              setDraggedIngredient(null);
              setDragOverIngredient(null);
            }}
          >
            <span
              role="button"
              tabIndex={0}
              aria-label={`Drag ingredient ${index + 1}`}
              className="drag-handle mt-1"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", String(index));
                e.dataTransfer.effectAllowed = "move";
                setDraggedIngredient(index);
              }}
              onDragEnd={() => {
                setDraggedIngredient(null);
                setDragOverIngredient(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  moveIngredient(index, index - 1);
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  moveIngredient(index, index + 1);
                }
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="9" cy="6" r="2" />
                <circle cx="9" cy="12" r="2" />
                <circle cx="9" cy="18" r="2" />
                <circle cx="15" cy="6" r="2" />
                <circle cx="15" cy="12" r="2" />
                <circle cx="15" cy="18" r="2" />
              </svg>
            </span>
            <input
              className="input w-20"
              placeholder="Qty"
              aria-label={`Ingredient ${index + 1} quantity`}
              value={row.quantity}
              onChange={(e) => setIngredient(index, "quantity", e.target.value)}
              onKeyDown={(e) => handleIngredientKeyDown(index, "quantity", e)}
              ref={(el) => {
                ingredientRefs.current[index] = el;
              }}
            />
            <input
              className="input w-24"
              placeholder="Unit"
              aria-label={`Ingredient ${index + 1} unit`}
              value={row.unit}
              onChange={(e) => setIngredient(index, "unit", e.target.value)}
              onKeyDown={(e) => handleIngredientKeyDown(index, "unit", e)}
            />
            <input
              className="input min-w-40 flex-1"
              placeholder="Ingredient name"
              aria-label={`Ingredient ${index + 1} name`}
              value={row.name}
              onChange={(e) => setIngredient(index, "name", e.target.value)}
              onKeyDown={(e) => handleIngredientKeyDown(index, "name", e)}
              aria-describedby={errorId(`ingredients.${index}.name`)}
            />
            <input
              className="input w-36"
              placeholder="Note (optional)"
              aria-label={`Ingredient ${index + 1} note`}
              value={row.note}
              onChange={(e) => setIngredient(index, "note", e.target.value)}
              onKeyDown={(e) => handleIngredientKeyDown(index, "note", e)}
            />
            <div className="flex gap-1">
              <button
                type="button"
                className="btn-secondary px-2 py-1 text-xs"
                onClick={() => moveIngredient(index, index - 1)}
                disabled={index === 0}
                aria-label="Move ingredient up"
              >
                ↑
              </button>
              <button
                type="button"
                className="btn-secondary px-2 py-1 text-xs"
                onClick={() => moveIngredient(index, index + 1)}
                disabled={index === form.ingredients.length - 1}
                aria-label="Move ingredient down"
              >
                ↓
              </button>
              <button
                type="button"
                className="btn-secondary px-2 py-1 text-xs"
                onClick={() => removeIngredient(index)}
                aria-label="Remove ingredient"
              >
                ×
              </button>
            </div>
            {fieldError(`ingredients.${index}.name`) ? (
              <p className="help-text w-full text-danger">{fieldError(`ingredients.${index}.name`)}</p>
            ) : null}
          </div>
        ))}
        {fieldError("ingredients") && !fieldError("ingredients.0.name") ? (
          <p className="help-text text-danger">{fieldError("ingredients")}</p>
        ) : null}
        <button type="button" className="btn-secondary self-start" onClick={addIngredientRow}>
          + Add ingredient
        </button>
      </fieldset>

      <fieldset className="card flex flex-col gap-3 p-6">
        <legend className="px-1 font-display text-lg font-semibold">Steps</legend>
        {form.steps.map((step, index) => (
          <div
            key={index}
            className={`flex items-start gap-2 rounded-lg border border-dashed p-2 transition-colors ${
              dragOverStep === index ? "border-accent bg-muted/50" : "border-transparent"
            } ${draggedStep === index ? "opacity-50" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverStep(index);
            }}
            onDragLeave={() => setDragOverStep(null)}
            onDrop={(e) => {
              e.preventDefault();
              const from = Number(e.dataTransfer.getData("text/plain"));
              if (!Number.isNaN(from) && from !== index) {
                moveStep(from, index);
              }
              setDraggedStep(null);
              setDragOverStep(null);
            }}
          >
            <span
              role="button"
              tabIndex={0}
              aria-label={`Drag step ${index + 1}`}
              className="drag-handle mt-2"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", String(index));
                e.dataTransfer.effectAllowed = "move";
                setDraggedStep(index);
              }}
              onDragEnd={() => {
                setDraggedStep(null);
                setDragOverStep(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  moveStep(index, index - 1);
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  moveStep(index, index + 1);
                }
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="9" cy="6" r="2" />
                <circle cx="9" cy="12" r="2" />
                <circle cx="9" cy="18" r="2" />
                <circle cx="15" cy="6" r="2" />
                <circle cx="15" cy="12" r="2" />
                <circle cx="15" cy="18" r="2" />
              </svg>
            </span>
            <span className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
              {index + 1}
            </span>
            <textarea
              className="input flex-1"
              rows={2}
              aria-label={`Step ${index + 1}`}
              value={step}
              onChange={(e) => {
                setDirty(true);
                setForm((f) => ({ ...f, steps: f.steps.map((s, i) => (i === index ? e.target.value : s)) }));
              }}
              aria-describedby={errorId(`steps.${index}`)}
              ref={(el) => {
                stepRefs.current[index] = el;
              }}
            />
            <div className="flex gap-1">
              <button
                type="button"
                className="btn-secondary px-2 py-1 text-xs"
                onClick={() => moveStep(index, index - 1)}
                disabled={index === 0}
                aria-label="Move step up"
              >
                ↑
              </button>
              <button
                type="button"
                className="btn-secondary px-2 py-1 text-xs"
                onClick={() => moveStep(index, index + 1)}
                disabled={index === form.steps.length - 1}
                aria-label="Move step down"
              >
                ↓
              </button>
              <button
                type="button"
                className="btn-secondary px-2 py-1 text-xs"
                onClick={() => removeStep(index)}
                aria-label="Remove step"
              >
                ×
              </button>
            </div>
            {fieldError(`steps.${index}`) ? (
              <p className="help-text w-full text-danger">{fieldError(`steps.${index}`)}</p>
            ) : null}
          </div>
        ))}
        <button type="button" className="btn-secondary self-start" onClick={addStepRow}>
          + Add step
        </button>
      </fieldset>

      <div className="card flex flex-col gap-2 p-6">
        <label htmlFor="notes" className="label">
          Notes
        </label>
          <textarea
          id="notes"
          className="input font-mono text-sm"
          rows={6}
          placeholder="e.g., Substitute almond milk for a dairy-free version"
          value={form.notesMarkdown}
          onChange={(e) => set("notesMarkdown", e.target.value)}
          aria-invalid={!!fieldError("notesMarkdown")}
          aria-describedby={errorId("notesMarkdown")}
        />
        <p className="help-text">Tips, variations, or storage instructions. Markdown is supported.</p>
        {renderFieldError("notesMarkdown")}
      </div>

      {isEdit && initial.id ? <MediaManager recipeId={initial.id} media={form.media} /> : null}
      {!isEdit ? <StagedMediaManager onItemsChange={setStagedMedia} onDirty={() => setDirty(true)} /> : null}

      <div className="form-action-bar flex flex-wrap items-center justify-between gap-3 rounded-t-xl">
        <div className="flex gap-3">
          <button type="submit" className="btn-primary" disabled={busy || !form.title.trim()}>
            {busy ? "Saving…" : isEdit ? "Save changes" : "Create recipe"}
          </button>
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
        {dirty ? <span className="text-xs text-muted-foreground">Unsaved changes</span> : null}
      </div>
    </form>
  );
}
