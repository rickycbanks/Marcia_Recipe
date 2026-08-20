"use client";

import { useMemo, useState, useRef } from "react";
import { Combobox, ComboboxInput, ComboboxOption, ComboboxOptions } from "@headlessui/react";
import Fuse from "fuse.js";

interface AutocompleteInputProps {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  /** When true, show top suggestions on focus even without a query. */
  immediate?: boolean;
}

export function AutocompleteInput({
  id,
  name,
  value,
  onChange,
  suggestions,
  placeholder,
  required,
  maxLength,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedby,
  immediate = false,
}: AutocompleteInputProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const fuse = useMemo(
    () =>
      new Fuse(suggestions, {
        threshold: 0.3,
        ignoreLocation: true,
      }),
    [suggestions],
  );

  const q = query.trim();

  const filtered = q
    ? fuse.search(query).slice(0, 10).map((r) => r.item)
    : immediate
      ? suggestions.slice(0, 10)
      : [];

  const exactMatch = q.length > 0 && suggestions.some((s) => s.toLowerCase() === q.toLowerCase());
  const showAddOption = q.length > 0 && !exactMatch;

  const statusId = id ? `${id}-status` : undefined;

  return (
    <Combobox
      value={value}
      onChange={(v) => {
        onChange(v ?? "");
        setOpen(false);
      }}
      onClose={() => setOpen(false)}
    >
      <div className="relative">
        <ComboboxInput
          id={id}
          name={name}
          className="input"
          placeholder={placeholder}
          required={required}
          maxLength={maxLength}
          aria-invalid={ariaInvalid || undefined}
          aria-describedby={ariaDescribedby}
          aria-autocomplete="list"
          autoComplete="off"
          displayValue={(v: string) => v}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
        />
        <ComboboxOptions
          anchor="bottom start"
          transition
          className="absolute z-30 mt-1 max-h-80 w-[--input-width] overflow-auto rounded-lg border border-border bg-card shadow-lg transition duration-100 ease-in data-[closed]:scale-95 data-[closed]:opacity-0"
        >
          {filtered.length === 0 && !showAddOption ? (
            <li className="px-4 py-3 text-sm text-muted-foreground">
              {q.length > 0
                ? <>No matches. Press Enter to add &ldquo;{q}&rdquo;.</>
                : "No matches."}
            </li>
          ) : (
            <>
              {showAddOption ? (
                <ComboboxOption
                  value={q}
                  className="cursor-pointer px-4 py-2 text-sm font-semibold data-[focus]:bg-muted data-[selected]:bg-muted"
                >
                  Add &ldquo;{q}&rdquo;
                </ComboboxOption>
              ) : null}
              {filtered.map((item) => (
                <ComboboxOption
                  key={item}
                  value={item}
                  className="cursor-pointer px-4 py-2 text-sm data-[focus]:bg-muted data-[selected]:bg-muted"
                >
                  {item}
                </ComboboxOption>
              ))}
            </>
          )}
        </ComboboxOptions>
        {statusId ? (
          <div id={statusId} role="status" aria-live="polite" className="sr-only">
            {filtered.length + (showAddOption ? 1 : 0)} suggestion{filtered.length + (showAddOption ? 1 : 0) === 1 ? "" : "s"} available.
          </div>
        ) : null}
      </div>
    </Combobox>
  );
}
