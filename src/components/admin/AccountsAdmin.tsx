"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const ASSIGNABLE = ["recipes.read", "mealPlans.use", "shoppingLists.use"] as const;
const DEPENDENCIES: Record<string, string[]> = {
  "mealPlans.use": ["recipes.read"],
  "shoppingLists.use": ["recipes.read"],
};
const CAPABILITY_LABELS: Record<string, string> = { "recipes.read": "Read recipes", "mealPlans.use": "Use meal plans", "shoppingLists.use": "Use shopping lists" };

interface AccountRow {
  id: string;
  username: string;
  displayName: string;
  type: "owner" | "guest";
  capabilities: string[];
  disabled: boolean;
  createdAt: string;
}

export function AccountsAdmin({ accounts, selfId }: { accounts: AccountRow[]; selfId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusyId(id);
    setError(null);
    const response = await fetch(`/api/accounts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusyId(null);
    if (!response.ok) {
      const parsed = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(parsed?.error ?? "Action failed.");
    }
    router.refresh();
  };

  const toggleCapability = (account: AccountRow, capability: string) => {
    const current = new Set(account.capabilities);
    if (current.has(capability)) {
      current.delete(capability);
      // Removing a dependency also removes dependents (server enforces too).
      for (const [dependent, deps] of Object.entries(DEPENDENCIES)) {
        if (deps.includes(capability)) current.delete(dependent);
      }
    } else {
      current.add(capability);
      for (const dep of DEPENDENCIES[capability] ?? []) current.add(dep);
    }
    void patch(account.id, { action: "setCapabilities", capabilities: [...current] });
  };

  return (
    <div className="card overflow-x-auto">
      {error ? (
        <p role="alert" className="border-b border-border px-4 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="px-4 py-3 font-medium">Account</th>
            <th className="px-4 py-3 font-medium">Type</th>
            <th className="px-4 py-3 font-medium">Capabilities</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {accounts.map((account) => (
            <tr key={account.id} className={account.disabled ? "opacity-60" : ""}>
              <td className="px-4 py-2.5">
                <span className="font-medium">{account.displayName}</span>{" "}
                <span className="text-xs text-muted-foreground">@{account.username}</span>
              </td>
              <td className="px-4 py-2.5 capitalize">{account.type}</td>
              <td className="px-4 py-2.5">
                {account.type === "owner" ? (
                  <span className="text-xs text-muted-foreground">all (owner)</span>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {ASSIGNABLE.map((cap) => (
                      <label key={cap} className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={account.capabilities.includes(cap)}
                          disabled={busyId === account.id || account.disabled}
                          onChange={() => toggleCapability(account, cap)}
                        />
                        {CAPABILITY_LABELS[cap] ?? "Additional access"}
                      </label>
                    ))}
                  </div>
                )}
              </td>
              <td className="px-4 py-2.5">
                {account.disabled ? <span className="badge">disabled</span> : <span className="badge">active</span>}
              </td>
              <td className="px-4 py-2.5 text-right">
                {account.id !== selfId ? (
                  <button
                    type="button"
                    className={account.disabled ? "btn-secondary px-2 py-1 text-xs" : "btn-danger px-2 py-1 text-xs"}
                    disabled={busyId === account.id}
                    onClick={() => patch(account.id, { action: "setDisabled", disabled: !account.disabled })}
                  >
                    {account.disabled ? "Re-enable" : "Disable"}
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground">you</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
