import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { Forbidden } from "@/components/Forbidden";
import { NewListForm } from "@/components/shopping/NewListForm";
import { getSessionAccount } from "@/lib/authorization/guards";
import { hasCapability } from "@/lib/authorization/capabilities";
import { listOwnShoppingLists } from "@/lib/shopping-lists/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Shopping Lists" };

export default async function ShoppingListsPage() {
  const account = await getSessionAccount();
  if (!account) redirect("/login?callbackUrl=/shopping-lists");
  if (!hasCapability(account, "shoppingLists.use")) {
    return <Forbidden message="Your account doesn't include the shopping lists capability." />;
  }
  const lists = await listOwnShoppingLists(account);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-3xl font-bold">Shopping Lists</h1>
        <NewListForm />
      </div>
      {lists.length === 0 ? (
        <EmptyState title="No shopping lists yet">
          <p>Create one here, or generate one from your meal plan for the week.</p>
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lists.map((list) => {
            const checked = list.items.filter((i) => i.checked).length;
            return (
              <li key={list.id}>
                <Link href={`/shopping-lists/${list.id}`} className="card block p-4 transition-shadow hover:shadow-md">
                  <h2 className="font-display text-lg font-semibold">{list.name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {list.items.length} items · {checked} checked
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Updated {new Date(list.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
