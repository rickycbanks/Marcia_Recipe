"use client";

import Link from "next/link";
import { useState } from "react";
import { ThemeModeToggle } from "./ThemeModeToggle";
import { SignOutButton } from "./SignOutButton";

export interface HeaderAccount {
  username: string;
  displayName: string;
  type: "owner" | "guest";
  capabilities: string[];
}

export function SiteHeader({ siteName, account }: { siteName: string; account: HeaderAccount | null }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const canMealPlan = account?.type === "owner" || account?.capabilities.includes("mealPlans.use");
  const canShop = account?.type === "owner" || account?.capabilities.includes("shoppingLists.use");

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex flex-wrap max-w-5xl items-center gap-3 px-4 py-3">
        <button
          type="button"
          className="btn-secondary md:hidden"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="mobile-primary-nav"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span aria-hidden>{menuOpen ? "×" : "☰"}</span>
        </button>
        <Link href="/" className="min-w-0 flex-1 md:flex-none font-display text-xl font-semibold text-foreground">
          {siteName}
        </Link>
        <nav aria-label="Primary" className="hidden flex-wrap items-center gap-x-4 gap-y-2 text-sm md:flex">
          <Link href="/recipes" className="text-muted-foreground hover:text-foreground">
            Recipes
          </Link>
          {canMealPlan ? (
            <Link href="/meal-planner" className="text-muted-foreground hover:text-foreground">
              Meal Planner
            </Link>
          ) : null}
          {canShop ? (
            <Link href="/shopping-lists" className="text-muted-foreground hover:text-foreground">
              Shopping Lists
            </Link>
          ) : null}
          {account?.type === "owner" ? (
            <Link href="/admin" className="text-muted-foreground hover:text-foreground">
              Admin
            </Link>
          ) : null}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <ThemeModeToggle />
          {account ? (
            <>
              <Link href="/account" className="hidden md:block text-sm text-muted-foreground hover:text-foreground">
                {account.displayName}
              </Link>
              <span className="hidden md:block"><SignOutButton /></span>
            </>
          ) : (
            <Link href="/login" className="btn-secondary text-sm">
              Sign in
            </Link>
          )}
        </div>
      </div>
      <nav
        id="mobile-primary-nav"
        aria-label="Primary"
        tabIndex={-1}
        className={`${menuOpen ? "flex" : "hidden"} flex-col gap-1 border-t border-border px-4 py-3 text-sm md:hidden`}
      >
        <Link href="/recipes" className="rounded px-2 py-2 text-muted-foreground hover:text-foreground" onClick={closeMenu}>
          Recipes
        </Link>
        {canMealPlan ? (
          <Link href="/meal-planner" className="rounded px-2 py-2 text-muted-foreground hover:text-foreground" onClick={closeMenu}>
            Meal Planner
          </Link>
        ) : null}
        {canShop ? (
          <Link href="/shopping-lists" className="rounded px-2 py-2 text-muted-foreground hover:text-foreground" onClick={closeMenu}>
            Shopping Lists
          </Link>
        ) : null}
        {account?.type === "owner" ? (
          <Link href="/admin" className="rounded px-2 py-2 text-muted-foreground hover:text-foreground" onClick={closeMenu}>
            Admin
          </Link>
        ) : null}
        {account ? <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <Link href="/account" className="min-w-0 rounded px-2 py-2" onClick={closeMenu}>{account.displayName}</Link>
          <SignOutButton />
        </div> : null}
      </nav>
    </header>
  );
}
