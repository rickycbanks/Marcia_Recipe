import { notFound, redirect } from "next/navigation";
import { ShoppingListView } from "@/components/shopping/ShoppingListView";
import { getSessionAccount } from "@/lib/authorization/guards";
import { hasCapability } from "@/lib/authorization/capabilities";
import { getOwnShoppingList } from "@/lib/shopping-lists/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Shopping List" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ShoppingListDetailPage({ params }: Props) {
  const account = await getSessionAccount();
  if (!account) redirect("/login?callbackUrl=/shopping-lists");
  if (!hasCapability(account, "shoppingLists.use")) notFound();
  const { id } = await params;
  // Paths derive from the caller's own account id — cross-account access is impossible.
  const list = await getOwnShoppingList(account, id).catch(() => null);
  if (!list) notFound();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <ShoppingListView
        list={{
          id: list.id,
          name: list.name,
          sourceMealPlanId: list.sourceMealPlanId,
          items: list.items,
        }}
      />
    </div>
  );
}
