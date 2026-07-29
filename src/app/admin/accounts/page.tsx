import { AccountsAdmin } from "@/components/admin/AccountsAdmin";
import { listAllAccounts } from "@/lib/accounts/service";
import { getSessionAccount } from "@/lib/authorization/guards";

export const dynamic = "force-dynamic";
export const metadata = { title: "Manage accounts" };

export default async function AdminAccountsPage() {
  const [accounts, self] = await Promise.all([listAllAccounts(), getSessionAccount()]);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-bold">Accounts</h1>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Disabling an account or changing capabilities takes effect immediately — active sessions are
        invalidated on the spot. Guests&apos; meal plans and shopping lists stay private to them and are not
        shown here.
      </p>
      <AccountsAdmin
        selfId={self?.id ?? ""}
        accounts={accounts.map((a) => ({
          id: a.id,
          username: a.username,
          displayName: a.displayName,
          type: a.type,
          capabilities: a.capabilities,
          disabled: a.disabledAt !== null,
          createdAt: a.createdAt,
        }))}
      />
    </div>
  );
}
