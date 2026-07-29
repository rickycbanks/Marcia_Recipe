import type { Account } from "@/types";
import { assertUuid } from "@/lib/ids";
import { accountSchema } from "@/lib/validation/schemas";
import { readJson, writeJsonAtomic } from "../atomic";
import { resolveWithin } from "../paths";
import { listDocuments } from "../repo";

const accountsDir = () => resolveWithin("accounts");
const accountPath = (id: string) => resolveWithin("accounts", `${assertUuid(id, "account id")}.json`);

/** Normalize a username for uniqueness comparisons and storage. */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export async function getAccount(id: string): Promise<Account | null> {
  return readJson(accountPath(id), accountSchema);
}

export async function listAccounts(): Promise<Account[]> {
  return listDocuments(accountsDir(), accountSchema);
}

export async function findAccountByUsername(username: string): Promise<Account | null> {
  const normalized = normalizeUsername(username);
  const accounts = await listAccounts();
  return accounts.find((a) => a.username === normalized) ?? null;
}

export async function findOwnerAccount(): Promise<Account | null> {
  const accounts = await listAccounts();
  return accounts.find((a) => a.type === "owner" && a.disabledAt === null) ?? null;
}

export async function anyOwnerExists(): Promise<boolean> {
  const accounts = await listAccounts();
  return accounts.some((a) => a.type === "owner");
}

/** Write under the caller's lock — uniqueness checks and writes must share one lock scope. */
export async function saveAccount(account: Account): Promise<void> {
  await writeJsonAtomic(accountPath(account.id), accountSchema.parse(account));
}
