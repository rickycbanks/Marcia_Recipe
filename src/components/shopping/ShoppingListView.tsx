"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

interface ListItem {
  id: string;
  text: string;
  quantity: number | null;
  unit: string | null;
  checked: boolean;
  source: "generated" | "manual";
  recipeId: string | null;
  recipeTitle: string | null;
}

interface Props {
  list: {
    id: string;
    name: string;
    sourceMealPlanId: string | null;
    items: ListItem[];
  };
}

export function ShoppingListView({ list }: Props) {
  const router = useRouter();
  const [items, setItems] = useState(list.items);
  const [name, setName] = useState(list.name);
  const [newItem, setNewItem] = useState("");
  const [error, setError] = useState<string | null>(null);

  const patch = async (body: Record<string, unknown>): Promise<boolean> => {
    const response = await fetch(`/api/shopping-lists/${list.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      setError("Could not save the change.");
      router.refresh();
      return false;
    }
    setError(null);
    return true;
  };

  const toggle = async (itemId: string, checked: boolean) => {
    const previous = items;
    setItems(items.map((i) => (i.id === itemId ? { ...i, checked } : i)));
    if (!(await patch({ action: "toggleItem", itemId, checked }))) setItems(previous);
  };

  const removeItem = async (itemId: string) => {
    const previous = items;
    setItems(items.filter((i) => i.id !== itemId));
    if (!(await patch({ action: "removeItem", itemId }))) setItems(previous);
  };

  const addItem = async (event: FormEvent) => {
    event.preventDefault();
    const text = newItem.trim();
    if (!text) return;
    setNewItem("");
    if (await patch({ action: "addItem", text })) router.refresh();
  };

  const rename = async () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== list.name) {
      await patch({ action: "rename", name: trimmed });
      router.refresh();
    }
  };

  const clearChecked = async () => {
    const previous = items;
    setItems(items.filter((i) => !i.checked));
    if (!(await patch({ action: "clearChecked" }))) setItems(previous);
  };

  const deleteList = async () => {
    if (!window.confirm(`Delete "${list.name}" permanently?`)) return;
    const response = await fetch(`/api/shopping-lists/${list.id}`, { method: "DELETE" });
    if (response.ok) router.push("/shopping-lists");
  };

  const checkedCount = items.filter((i) => i.checked).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          className="input max-w-sm font-display text-xl font-semibold"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={rename}
          aria-label="List name"
        />
        <span className="text-sm text-muted-foreground">
          {checkedCount}/{items.length} checked
        </span>
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn-secondary text-sm" onClick={clearChecked} disabled={checkedCount === 0}>
            Clear checked
          </button>
          <button type="button" className="btn-danger text-sm" onClick={deleteList}>
            Delete list
          </button>
        </div>
      </div>

      {list.sourceMealPlanId ? (
        <p className="text-xs text-muted-foreground">Generated from a weekly meal plan (snapshot — later recipe edits don&apos;t change this list).</p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <ul className="card divide-y divide-border">
        {items.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-muted-foreground">No items yet — add one below.</li>
        ) : (
          items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
              <input
                type="checkbox"
                id={`item-${item.id}`}
                checked={item.checked}
                onChange={(e) => toggle(item.id, e.target.checked)}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              <label htmlFor={`item-${item.id}`} className={`flex-1 text-sm ${item.checked ? "text-muted-foreground line-through" : ""}`}>
                {item.text}
                {item.recipeTitle ? <span className="ml-2 text-xs text-muted-foreground">({item.recipeTitle})</span> : null}
              </label>
              <button
                type="button"
                className="text-muted-foreground hover:text-danger"
                onClick={() => removeItem(item.id)}
                aria-label={`Remove ${item.text}`}
              >
                ×
              </button>
            </li>
          ))
        )}
      </ul>

      <form onSubmit={addItem} className="flex gap-2">
        <label htmlFor="add-item" className="sr-only">
          Add item
        </label>
        <input
          id="add-item"
          className="input"
          placeholder="Add an item, e.g. 200 g feta…"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          maxLength={200}
        />
        <button type="submit" className="btn-primary" disabled={!newItem.trim()}>
          Add
        </button>
      </form>
    </div>
  );
}
