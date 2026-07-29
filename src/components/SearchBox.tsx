"use client";

import Fuse from "fuse.js";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

interface SearchEntry {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string | null;
  tags: string[];
}

/**
 * Browser-side fuzzy search. The index endpoint is already visibility-filtered
 * per request, so guests and anonymous visitors only ever receive entries they
 * may see. Nothing is persisted to local storage.
 */
export function SearchBox({ placeholder = "Search recipes…" }: { placeholder?: string }) {
  const [entries, setEntries] = useState<SearchEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/search-index", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { entries: [] }))
      .then((data: { entries: SearchEntry[] }) => {
        if (!cancelled) setEntries(data.entries);
      })
      .catch(() => setEntries([]));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const fuse = useMemo(
    () =>
      new Fuse(entries ?? [], {
        keys: [
          { name: "title", weight: 3 },
          { name: "tags", weight: 2 },
          { name: "category", weight: 1.5 },
          { name: "description", weight: 1 },
        ],
        threshold: 0.35,
        ignoreLocation: true,
      }),
    [entries],
  );

  const results = query.trim() ? fuse.search(query).slice(0, 8) : [];

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <label className="sr-only" htmlFor="recipe-search">
        Search recipes
      </label>
      <input
        id="recipe-search"
        type="search"
        className="input"
        placeholder={placeholder}
        value={query}
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && query.trim() ? (
        <ul
          className="absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-border bg-card shadow-lg"
          role="listbox"
        >
          {results.length === 0 ? (
            <li className="px-4 py-3 text-sm text-muted-foreground">
              {entries === null ? "Loading index…" : "No recipes match your search."}
            </li>
          ) : (
            results.map(({ item }) => (
              <li key={item.id} role="option" aria-selected="false">
                <Link
                  href={`/recipes/${item.slug}`}
                  className="block px-4 py-2 text-sm hover:bg-muted"
                  onClick={() => {
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <span className="font-medium">{item.title}</span>
                  {item.category ? <span className="ml-2 text-muted-foreground">{item.category}</span> : null}
                </Link>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
