import Link from "next/link";
import { listAllRecipesForOwner } from "@/lib/recipes/service";
import { listAllAccounts } from "@/lib/accounts/service";
import { listAllInvitations } from "@/lib/invitations/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin" };

export default async function AdminDashboardPage() {
  const [recipes, accounts, invitations] = await Promise.all([
    listAllRecipesForOwner(),
    listAllAccounts(),
    listAllInvitations(),
  ]);
  const archived = recipes.filter((r) => r.archivedAt !== null).length;
  const guests = accounts.filter((a) => a.type === "guest").length;
  const pendingInvites = invitations.filter((i) => i.status === "pending").length;

  const cards = [
    { href: "/admin/recipes", title: "Recipes", stat: `${recipes.length} total · ${archived} archived`, description: "Create, edit, archive and import recipes." },
    { href: "/admin/accounts", title: "Accounts", stat: `${accounts.length} total · ${guests} guests`, description: "Manage guest capabilities and access." },
    { href: "/admin/invitations", title: "Invitations", stat: `${pendingInvites} pending`, description: "Invite guests with chosen capabilities." },
    { href: "/admin/settings", title: "Settings", stat: "Site", description: "Site name, default visibility, theme." },
    { href: "/admin/backups", title: "Backups", stat: "Archives", description: "Create and download full-site backups." },
    { href: "/admin/exports", title: "Exports", stat: "Markdown", description: "Download recipes, meal plans, and shopping lists as Markdown." },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-bold">Admin</h1>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <li key={card.href}>
            <Link href={card.href} className="card block h-full p-5 transition-shadow hover:shadow-md">
              <h2 className="font-display text-xl font-semibold">{card.title}</h2>
              <p className="mt-1 text-sm font-medium text-accent">{card.stat}</p>
              <p className="mt-2 text-sm text-muted-foreground">{card.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
