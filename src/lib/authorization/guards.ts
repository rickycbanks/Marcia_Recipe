import type { Account } from "@/types";
import { forbidden, unauthenticated } from "@/lib/errors";
import type { Capability } from "@/lib/validation/constants";
import { auth } from "@/lib/auth/session";
import { getAccount } from "@/lib/storage/repositories/accounts";
import { hasCapability } from "./capabilities";
export { assertSameOrigin } from "./origin";

/**
 * Centralized authorization. Every protected operation — server component,
 * route handler, or service — goes through these guards. The JWT is only a
 * hint: the account file is loaded on EVERY call, so disabling an account,
 * rotating a password, or changing capabilities takes effect immediately
 * (sessionVersion mismatch / disabledAt / capability set are re-evaluated).
 */
export async function getSessionAccount(): Promise<Account | null> {
  const session = await auth();
  const accountId = session?.user?.id;
  if (!accountId) return null;
  let account: Account | null = null;
  try {
    account = await getAccount(accountId);
  } catch {
    return null;
  }
  if (!account) return null;
  if (account.disabledAt !== null) return null;
  if (account.sessionVersion !== session.sessionVersion) return null;
  return account;
}

export async function requireSession(): Promise<Account> {
  const account = await getSessionAccount();
  if (!account) throw unauthenticated();
  return account;
}

export async function requireOwner(): Promise<Account> {
  const account = await requireSession();
  if (account.type !== "owner") throw forbidden("Owner access required");
  return account;
}

export async function requireCapability(capability: Capability): Promise<Account> {
  const account = await requireSession();
  if (!hasCapability(account, capability)) {
    throw forbidden(`Missing capability: ${capability}`);
  }
  return account;
}
