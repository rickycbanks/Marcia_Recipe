"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface AdminRecipeRow {
  id: string;
  slug: string;
  title: string;
  visibility: string;
  category: string | null;
  archived: boolean;
  mediaCount: number;
  updatedAt: string;
}

export function RecipeAdminTable({ recipes }: { recipes: AdminRecipeRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (id: string, fn: () => Promise<Response>) => {
    setBusyId(id);
    setError(null);
    const response = await fn();
    setBusyId(null);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Action failed.");
    }
    router.refresh();
  };

  const archive = (id: string) => act(id, () => fetch(`/api/recipes/${id}/archive`, { method: "POST" }));
  const restore = (id: string) => act(id, () => fetch(`/api/recipes/${id}/archive`, { method: "DELETE" }));
  const permanentDelete = (id: string, title: string) => {
    if (!window.confirm(`Permanently delete "${title}"? This cannot be undone. Meal plans that reference it will block deletion.`)) return;
    void act(id, () =>
      fetch(`/api/recipes/${id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      }),
    );
  };

  return (
    <div className="card overflow-x-auto">
      {error ? (
        <p role="alert" className="border-b border-border px-4 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="px-4 py-3 font-medium">Title</th>
            <th className="px-4 py-3 font-medium">Visibility</th>
            <th className="px-4 py-3 font-medium">Category</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {recipes.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                No recipes yet — create your first one.
              </td>
            </tr>
          ) : (
            recipes.map((recipe) => (
              <tr key={recipe.id} className={recipe.archived ? "opacity-60" : ""}>
                <td className="px-4 py-2.5">
                  <Link href={`/recipes/${recipe.slug}`} className="font-medium hover:underline">
                    {recipe.title}
                  </Link>
                  <span className="ml-2 text-xs text-muted-foreground">/{recipe.slug}</span>
                </td>
                <td className="px-4 py-2.5">{recipe.visibility}</td>
                <td className="px-4 py-2.5">{recipe.category ?? "—"}</td>
                <td className="px-4 py-2.5">{recipe.archived ? <span className="badge">archived</span> : <span className="badge">live</span>}</td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-2 text-xs">
                    <Link href={`/admin/recipes/${recipe.id}/edit`} className="btn-secondary px-2 py-1">
                      Edit
                    </Link>
                    {recipe.archived ? (
                      <>
                        <button type="button" className="btn-secondary px-2 py-1" disabled={busyId === recipe.id} onClick={() => restore(recipe.id)}>
                          Restore
                        </button>
                        <button type="button" className="btn-danger px-2 py-1" disabled={busyId === recipe.id} onClick={() => permanentDelete(recipe.id, recipe.title)}>
                          Delete
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn-secondary px-2 py-1" disabled={busyId === recipe.id} onClick={() => archive(recipe.id)}>
                        Archive
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
