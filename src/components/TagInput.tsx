"use client";

import { useMemo, useRef, useState } from "react";
import { Combobox, ComboboxInput, ComboboxOption, ComboboxOptions } from "@headlessui/react";
import Fuse from "fuse.js";
import { MAX_TAGS } from "@/lib/validation/constants";

const TAG_MAX_LENGTH = 40;

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
  maxTags?: number;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

export function TagInput({
  value,
  onChange,
  suggestions,
  maxTags = MAX_TAGS,
  id,
  "aria-describedby": ariaDescribedby,
  "aria-invalid": ariaInvalid,
}: TagInputProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const normalized = useMemo(() => value.map((t) => t.toLowerCase()), [value]);

  const fuse = useMemo(
    () =>
      new Fuse(suggestions.filter((s) => !normalized.includes(s.toLowerCase())), {
        threshold: 0.3,
        ignoreLocation: true,
      }),
    [suggestions, normalized],
  );

  const filtered = query.trim()
    ? fuse.search(query).slice(0, 10).map((r) => r.item)
    : [];

  const addTag = (raw: string) => {
    const tag = raw.trim().replace(/^#/, "").toLowerCase();
    if (!tag || tag.length > TAG_MAX_LENGTH) return;
    if (normalized.includes(tag)) return;
    if (value.length >= maxTags) return;
    onChange([...value, tag]);
    setQuery("");
  };

  const removeTag = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "Tab" || e.key === ",") {
      if (query.trim()) {
        e.preventDefault();
        addTag(query);
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (text.includes(",")) {
      e.preventDefault();
      const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
      const next = [...value];
      for (const part of parts) {
        const tag = part.replace(/^#/, "").toLowerCase();
        if (!tag || tag.length > TAG_MAX_LENGTH) continue;
        if (next.map((t) => t.toLowerCase()).includes(tag)) continue;
        if (next.length >= maxTags) break;
        next.push(tag);
      }
      onChange(next);
      setQuery("");
    }
  };

  const statusId = id ? `${id}-status` : undefined;

  return (
    <div>
      {value.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5" role="list" aria-label="Current tags">
          {value.map((tag, index) => (
            <span
              key={`${tag}-${index}`}
              role="listitem"
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium"
            >
              {tag}
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                onClick={() => removeTag(index)}
                className="ml-0.5 text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <Combobox
        value={null}
        onChange={(v: string | null) => {
          if (v) addTag(v);
          setQuery("");
        }}
        onClose={() => setOpen(false)}
        immediate
      >
        <div className="relative">
          <ComboboxInput
            ref={inputRef}
            id={id}
            className="input"
            placeholder={value.length >= maxTags ? `Maximum ${maxTags} tags` : "Type a tag, press Enter to add"}
            maxLength={TAG_MAX_LENGTH}
            disabled={value.length >= maxTags}
            aria-invalid={ariaInvalid || undefined}
            aria-describedby={ariaDescribedby}
            aria-autocomplete="list"
            autoComplete="off"
            displayValue={() => query}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              const val = e.target.value;
              if (val.includes(",")) {
                const parts = val.split(",").map((p) => p.trim()).filter(Boolean);
                for (const part of parts) addTag(part);
                setQuery("");
                return;
              }
              setQuery(val);
              setOpen(true);
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
          />
          <ComboboxOptions
            anchor="bottom start"
            transition
            className="absolute z-30 mt-1 max-h-80 w-[--input-width] overflow-auto rounded-lg border border-border bg-card shadow-lg transition duration-100 ease-in data-[closed]:scale-95 data-[closed]:opacity-0"
          >
            {filtered.length === 0 ? (
              <li className="px-4 py-3 text-sm text-muted-foreground">No matches. Press Enter to add.</li>
            ) : (
              filtered.map((item) => (
                <ComboboxOption
                  key={item}
                  value={item}
                  className="cursor-pointer px-4 py-2 text-sm data-[focus]:bg-muted data-[selected]:bg-muted"
                >
                  {item}
                </ComboboxOption>
              ))
            )}
          </ComboboxOptions>
          {statusId ? (
            <div id={statusId} role="status" aria-live="polite" className="sr-only">
              {filtered.length} suggestion{filtered.length === 1 ? "" : "s"} available.
            </div>
          ) : null}
        </div>
      </Combobox>
      {value.length >= maxTags ? (
        <p className="help-text mt-1">Maximum of {maxTags} tags reached.</p>
      ) : (
        <p className="help-text mt-1">Separate tags with commas, or press Enter.</p>
      )}
    </div>
  );
}
