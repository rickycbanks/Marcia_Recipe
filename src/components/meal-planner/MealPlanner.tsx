"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { shiftWeekId } from "@/lib/time";

export interface PlannerEntry {
  entryId: string;
  day: number;
  slot: string;
  note: string | null;
  recipeId: string;
  title: string;
  slug: string;
  /** Archived/unavailable recipes render as tombstones (title only, no link). */
  tombstone: boolean;
}

interface AvailableRecipe {
  id: string;
  slug: string;
  title: string;
}

interface Props {
  weekId: string;
  slots: string[];
  entries: PlannerEntry[];
  availableRecipes: AvailableRecipe[];
  canGenerateList: boolean;
}

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function MealPlanner({ weekId, slots, entries, availableRecipes, canGenerateList }: Props) {
  const router = useRouter();
  const [localEntries, setLocalEntries] = useState(entries);
  const [picker, setPicker] = useState<{ day: number; slot: string } | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickerResults = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    const pool = q ? availableRecipes.filter((r) => r.title.toLowerCase().includes(q)) : availableRecipes;
    return pool.slice(0, 12);
  }, [availableRecipes, pickerQuery]);

  const persistEntries = async (next: { day: number; slot: string; recipeId: string; note: string | null }[]) => {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/meal-plans", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ weekId, entries: next }),
    });
    setBusy(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Could not save the plan.");
      router.refresh();
      return false;
    }
    return true;
  };

  const addEntry = async (recipeId: string) => {
    if (!picker) return;
    const recipe = availableRecipes.find((r) => r.id === recipeId);
    if (!recipe) return;
    const optimistic: PlannerEntry = {
      entryId: `pending-${picker.day}-${picker.slot}-${localEntries.length}`,
      day: picker.day,
      slot: picker.slot,
      note: null,
      recipeId,
      title: recipe.title,
      slug: recipe.slug,
      tombstone: false,
    };
    const next = [...localEntries, optimistic];
    setLocalEntries(next);
    setPicker(null);
    setPickerQuery("");
    const ok = await persistEntries(next.map(({ day, slot, recipeId: rid, note }) => ({ day, slot, recipeId: rid, note })));
    router.refresh();
    if (!ok) return;
  };

  const removeEntry = async (entryId: string) => {
    const previous = localEntries;
    setLocalEntries(localEntries.filter((e) => e.entryId !== entryId));
    const response = await fetch("/api/meal-plans", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ weekId, entryId }),
    });
    if (!response.ok) setLocalEntries(previous);
    router.refresh();
  };

  const generateList = async () => {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/shopping-lists/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ weekId }),
    });
    setBusy(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Could not generate a shopping list.");
      return;
    }
    const body = (await response.json()) as { id: string };
    router.push(`/shopping-lists/${body.id}`);
  };

  const gotoWeek = (target: string) => router.push(`/meal-planner?week=${target}`);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary" onClick={() => gotoWeek(shiftWeekId(weekId, -1))}>
          ← Previous week
        </button>
        <button type="button" className="btn-secondary" onClick={() => router.push("/meal-planner")}>
          This week
        </button>
        <button type="button" className="btn-secondary" onClick={() => gotoWeek(shiftWeekId(weekId, 1))}>
          Next week →
        </button>
        <div className="ml-auto">
          {canGenerateList ? (
            <button type="button" className="btn-primary" onClick={generateList} disabled={busy || localEntries.length === 0}>
              Generate shopping list
            </button>
          ) : null}
        </div>
        <a href={`/api/meal-plans/${weekId}/export`} className="btn-secondary">
          Export
        </a>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {DAY_NAMES.map((dayName, day) => (
          <section key={dayName} className="card flex flex-col gap-3 p-4" aria-label={dayName}>
            <h2 className="font-display text-lg font-semibold">{dayName}</h2>
            {slots.map((slot) => {
              const slotEntries = localEntries.filter((e) => e.day === day && e.slot === slot);
              return (
                <div key={slot} className="rounded-lg border border-border p-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{slot}</span>
                    <button
                      type="button"
                      className="text-xs text-accent hover:underline disabled:opacity-50"
                      disabled={busy}
                      onClick={() => {
                        setPicker({ day, slot });
                        setPickerQuery("");
                      }}
                      aria-label={`Add recipe to ${dayName} ${slot}`}
                    >
                      + Add
                    </button>
                  </div>
                  {slotEntries.length === 0 ? (
                    <p className="py-1 text-xs text-muted-foreground">—</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {slotEntries.map((entry) => (
                        <li key={entry.entryId} className="flex items-start justify-between gap-2 text-sm">
                          {entry.tombstone ? (
                            <span className="italic text-muted-foreground">{entry.title}</span>
                          ) : (
                            <Link href={`/recipes/${entry.slug}`} className="hover:underline">
                              {entry.title}
                            </Link>
                          )}
                          <button
                            type="button"
                            className="shrink-0 text-muted-foreground hover:text-danger"
                            onClick={() => removeEntry(entry.entryId)}
                            aria-label={`Remove ${entry.title}`}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>

      {picker ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Choose a recipe"
          onClick={() => setPicker(null)}
        >
          <div className="card w-full max-w-md p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 font-display text-lg font-semibold">
              Add to {DAY_NAMES[picker.day]} · {picker.slot}
            </h3>
            <input
              autoFocus
              className="input mb-2"
              placeholder="Filter recipes…"
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
            />
            {pickerResults.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No recipes match.</p>
            ) : (
              <ul className="max-h-64 overflow-auto">
                {pickerResults.map((recipe) => (
                  <li key={recipe.id}>
                    <button
                      type="button"
                      className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => addEntry(recipe.id)}
                    >
                      {recipe.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="btn-secondary mt-2 w-full" onClick={() => setPicker(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
