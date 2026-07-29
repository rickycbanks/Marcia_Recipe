import Link from "next/link";
import { ThemeModeToggle } from "./ThemeModeToggle";
import { SignOutButton } from "./SignOutButton";

export interface HeaderAccount {
  username: string;
  displayName: string;
  type: "owner" | "guest";
  capabilities: string[];
}

export function SiteHeader({ siteName, account }: { siteName: string; account: HeaderAccount | null }) {
  const canMealPlan = account?.type === "owner" || account?.capabilities.includes("mealPlans.use");
  const canShop = account?.type === "owner" || account?.capabilities.includes("shoppingLists.use");
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Link href="/" className="font-display text-xl font-semibold text-foreground">
          {siteName}
        </Link>
        <nav aria-label="Primary" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
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
        <div className="ml-auto flex items-center gap-3">
          <ThemeModeToggle />
          {account ? (
            <>
              <Link href="/account" className="text-sm text-muted-foreground hover:text-foreground">
                {account.displayName}
              </Link>
              <SignOutButton />
            </>
          ) : (
            <Link href="/login" className="btn-secondary text-sm">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
