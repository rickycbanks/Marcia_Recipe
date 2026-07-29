"use client";

import { useSyncExternalStore } from "react";

/** Toggles light/dark; persisted to localStorage and applied via data-mode. */
export function ThemeModeToggle() {
  const mode = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener("theme-mode-change", onStoreChange);
      return () => window.removeEventListener("theme-mode-change", onStoreChange);
    },
    () => (document.documentElement.dataset.mode === "dark" ? "dark" : "light"),
    () => "light",
  );

  const toggle = () => {
    const next = mode === "dark" ? "light" : "dark";
    document.documentElement.dataset.mode = next;
    try {
      localStorage.setItem("theme-mode", next);
    } catch {
      /* private mode — session-only preference */
    }
    window.dispatchEvent(new Event("theme-mode-change"));
  };

  return (
    <button type="button" onClick={toggle} className="btn-secondary px-2 py-1" aria-label={`Switch to ${mode === "dark" ? "light" : "dark"} mode`}>
      {mode === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
