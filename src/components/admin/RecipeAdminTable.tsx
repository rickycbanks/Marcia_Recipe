"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

interface AdminRecipeRow {
  id: string;
  slug: string;
  title: string;
  visibility: string;
  category: string | null;
  archived: boolean;
  mediaCount: number;
  primaryMediaId: string | null;
  updatedAt: string;
}

type SortKey = "title" | "updatedAt" | "status";
type SortDir = "asc" | "desc";

function SortHeader({
  label,
  sortKey,
  active,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className="flex items-center gap-1 font-medium hover:text-foreground"
      aria-label={`Sort by ${label}`}
    >
      {label}
      {active ? <span aria-hidden>{dir === "asc" ? "↑" : "↓"}</span> : null}
    </button>
  );
}

export function RecipeAdminTable({ recipes }: { recipes: AdminRecipeRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "live" | "archived">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "title", dir: "asc" });

  const categories = useMemo(
    () => [...new Set(recipes.map((r) => r.category).filter((c): c is string => !!c))].sort(),
    [recipes],
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    let rows = recipes.filter((r) => {
      if (statusFilter === "live" && r.archived) return false;
      if (statusFilter === "archived" && !r.archived) return false;
      if (categoryFilter !== "all" && r.category !== categoryFilter) return false;
      if (normalized) {
        const haystack = `${r.title} ${r.category ?? ""} ${r.visibility}`.toLowerCase();
        if (!haystack.includes(normalized)) return false;
      }
      return true;
    });
    rows = [...rows].sort((a, b) => {
      const dir = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "title") return a.title.localeCompare(b.title) * dir;
      if (sort.key === "updatedAt") return (a.updatedAt > b.updatedAt ? 1 : -1) * dir;
      if (sort.key === "status") return (Number(a.archived) - Number(b.archived)) * dir;
      return 0;
    });
    return rows;
  }, [recipes, query, statusFilter, categoryFilter, sort]);

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

  const handleSort = (key: SortKey) => {
    setSort((s) => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }));
  };

  return (
    <div className="card overflow-x-auto">
      {error ? (
        <p role="alert" className="border-b border-border px-4 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <label htmlFor="admin-recipe-search" className="sr-only">
          Search recipes
        </label>
        <input
          id="admin-recipe-search"
          type="search"
          className="input max-w-xs"
          placeholder="Search recipes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label htmlFor="admin-status-filter" className="sr-only">
          Filter by status
        </label>
        <select
          id="admin-status-filter"
          className="input w-auto"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
        >
          <option value="all">All statuses</option>
          <option value="live">Live</option>
          <option value="archived">Archived</option>
        </select>
        <label htmlFor="admin-category-filter" className="sr-only">
          Filter by category
        </label>
        <select
          id="admin-category-filter"
          className="input w-auto"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="px-4 py-3 font-medium" aria-label="Thumbnail">
              <span className="sr-only">Thumbnail</span>
            </th>
            <th className="px-4 py-3">
              <SortHeader label="Title" sortKey="title" active={sort.key === "title"} dir={sort.dir} onSort={handleSort} />
            </th>
            <th className="px-4 py-3 font-medium">Visibility</th>
            <th className="px-4 py-3 font-medium">Category</th>
            <th className="px-4 py-3">
              <SortHeader label="Status" sortKey="status" active={sort.key === "status"} dir={sort.dir} onSort={handleSort} />
            </th>
            <th className="px-4 py-3">
              <SortHeader label="Updated" sortKey="updatedAt" active={sort.key === "updatedAt"} dir={sort.dir} onSort={handleSort} />
            </th>
            <th className="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {filtered.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                No recipes match your filters.
              </td>
            </tr>
          ) : (
            filtered.map((recipe) => (
              <tr key={recipe.id} className={recipe.archived ? "opacity-60" : ""}>
                <td className="px-4 py-2.5">
                  {recipe.primaryMediaId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/media/${recipe.id}/${recipe.primaryMediaId}`}
                      alt=""
                      className="h-10 w-10 rounded-md border border-border object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted text-xs text-muted-foreground">
                      {recipe.mediaCount > 0 ? recipe.mediaCount : "—"}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <Link href={`/recipes/${recipe.slug}`} className="font-medium hover:underline">
                    {recipe.title}
                  </Link>
                  <span className="ml-2 text-xs text-muted-foreground">/{recipe.slug}</span>
                </td>
                <td className="px-4 py-2.5">{recipe.visibility}</td>
                <td className="px-4 py-2.5">{recipe.category ?? "—"}</td>
                <td className="px-4 py-2.5">
                  {recipe.archived ? <span className="badge">archived</span> : <span className="badge">live</span>}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {new Date(recipe.updatedAt).toLocaleDateString()}
                </td>
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
