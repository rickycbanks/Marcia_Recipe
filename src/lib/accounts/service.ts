import type { Account } from "@/types";
import { audit } from "@/lib/audit/log";
import { badRequest, conflict, forbidden, gone, notFound, unauthenticated } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { SCHEMA_VERSIONS } from "@/lib/validation/constants";
import type { GuestCapability } from "@/lib/validation/constants";
import { displayNameSchema, passwordSchema, usernameSchema } from "@/lib/validation/schemas";
import { hashPassword, verifyPassword } from "@/lib/auth/passwords";
import { safeEqual } from "@/lib/auth/tokens";
import { normalizeCapabilities, validateCapabilityAssignment } from "@/lib/authorization/capabilities";
import { withWriteLock } from "@/lib/storage/lock";
import {
  anyOwnerExists,
  findAccountByUsername,
  getAccount,
  listAccounts,
  normalizeUsername,
  saveAccount,
} from "@/lib/storage/repositories/accounts";
import { getSiteConfig, saveSiteConfig } from "@/lib/storage/repositories/config";

export interface SetupOwnerInput {
  token: string;
  username: string;
  displayName: string;
  password: string;
}

/**
 * First-run owner creation. Requires the deployment-provided SETUP_TOKEN,
 * runs atomically under the write lock so concurrent requests cannot create
 * two owners, and permanently disables web setup once an owner exists.
 */
export async function setupFirstOwner(input: SetupOwnerInput): Promise<Account> {
  return withWriteLock(async () => {
    if (await anyOwnerExists()) throw gone("Setup has already been completed");
    const { SETUP_TOKEN } = getEnv();
    if (!SETUP_TOKEN) throw gone("Web setup is disabled (no SETUP_TOKEN configured)");
    if (!safeEqual(input.token, SETUP_TOKEN)) throw forbidden("Invalid setup token");

    const usernameResult = usernameSchema.safeParse(normalizeUsername(input.username));
    if (!usernameResult.success) throw badRequest(usernameResult.error.issues[0]?.message ?? "Invalid username");
    const displayNameResult = displayNameSchema.safeParse(input.displayName);
    if (!displayNameResult.success) throw badRequest(displayNameResult.error.issues[0]?.message ?? "Invalid display name");
    const passwordResult = passwordSchema.safeParse(input.password);
    if (!passwordResult.success) throw badRequest(passwordResult.error.issues[0]?.message ?? "Invalid password");
    const username = usernameResult.data;
    const displayName = displayNameResult.data;
    if (await findAccountByUsername(username)) throw conflict("That username is already taken");

    const now = nowIso();
    const owner: Account = {
      schemaVersion: SCHEMA_VERSIONS.account,
      id: newId(),
      username,
      displayName,
      password: await hashPassword(input.password),
      type: "owner",
      capabilities: [],
      sessionVersion: 1,
      disabledAt: null,
      createdViaInvitationId: null,
      createdAt: now,
      updatedAt: now,
    };
    await saveAccount(owner);
    const config = await getSiteConfig();
    await saveSiteConfig({ ...config, setupCompletedAt: now });
    await audit({ type: "setup.completed", actorAccountId: owner.id, clientAddress: null, detail: {} });
    await audit({
      type: "account.created",
      actorAccountId: owner.id,
      clientAddress: null,
      detail: { accountId: owner.id, username: owner.username, via: "setup" },
    });
    return owner;
  });
}

/** CLI variant of owner creation — no token needed (local shell access is the auth boundary). */
export async function createOwnerViaCli(input: Omit<SetupOwnerInput, "token">): Promise<Account> {
  return withWriteLock(async () => {
    if (await anyOwnerExists()) throw gone("An owner account already exists");
    const username = usernameSchema.parse(normalizeUsername(input.username));
    const displayName = displayNameSchema.parse(input.displayName);
    passwordSchema.parse(input.password);
    const now = nowIso();
    const owner: Account = {
      schemaVersion: SCHEMA_VERSIONS.account,
      id: newId(),
      username,
      displayName,
      password: await hashPassword(input.password),
      type: "owner",
      capabilities: [],
      sessionVersion: 1,
      disabledAt: null,
      createdViaInvitationId: null,
      createdAt: now,
      updatedAt: now,
    };
    await saveAccount(owner);
    const config = await getSiteConfig();
    await saveSiteConfig({ ...config, setupCompletedAt: now });
    await audit({ type: "setup.completed", actorAccountId: owner.id, clientAddress: null, detail: { via: "cli" } });
    return owner;
  });
}

/** Self-service password change; bumps sessionVersion so other sessions die. */
export async function changePassword(account: Account, currentPassword: string, newPassword: string): Promise<void> {
  const passwordResult = passwordSchema.safeParse(newPassword);
  if (!passwordResult.success) throw badRequest(passwordResult.error.issues[0]?.message ?? "Invalid password");
  const ok = await verifyPassword(currentPassword, account.password);
  if (!ok) throw unauthenticated("Current password is incorrect");
  await withWriteLock(async () => {
    const fresh = await getAccount(account.id);
    if (!fresh) throw notFound("Account not found");
    await saveAccount({
      ...fresh,
      password: await hashPassword(newPassword),
      sessionVersion: fresh.sessionVersion + 1,
      updatedAt: nowIso(),
    });
    await audit({ type: "auth.password.changed", actorAccountId: account.id, clientAddress: null, detail: {} });
  });
}

/** Local CLI password reset for lockout recovery. */
export async function resetPasswordViaCli(username: string, newPassword: string): Promise<void> {
  passwordSchema.parse(newPassword);
  await withWriteLock(async () => {
    const account = await findAccountByUsername(username);
    if (!account) throw notFound(`No account named ${username}`);
    await saveAccount({
      ...account,
      password: await hashPassword(newPassword),
      sessionVersion: account.sessionVersion + 1,
      updatedAt: nowIso(),
    });
    await audit({ type: "auth.password.changed", actorAccountId: account.id, clientAddress: null, detail: { via: "cli-reset" } });
  });
}

/** Disable or re-enable an account. Effect is immediate (per-request account reload). */
export async function setAccountDisabled(owner: Account, targetId: string, disabled: boolean): Promise<Account> {
  if (owner.type !== "owner") throw forbidden("Only the owner can manage accounts");
  return withWriteLock(async () => {
    const target = await getAccount(targetId);
    if (!target) throw notFound("Account not found");
    if (target.type === "owner" && disabled) {
      const accounts = await listAccounts();
      const otherEnabledOwners = accounts.filter((a) => a.type === "owner" && a.id !== target.id && a.disabledAt === null);
      if (otherEnabledOwners.length === 0) {
        throw conflict("Cannot disable the last enabled owner account");
      }
    }
    const updated: Account = {
      ...target,
      disabledAt: disabled ? nowIso() : null,
      sessionVersion: target.sessionVersion + 1,
      updatedAt: nowIso(),
    };
    await saveAccount(updated);
    await audit({
      type: disabled ? "account.disabled" : "account.enabled",
      actorAccountId: owner.id,
      clientAddress: null,
      detail: { accountId: target.id, username: target.username },
    });
    return updated;
  });
}

/** Edit a guest's capabilities. Security-sensitive: bumps sessionVersion immediately. */
export async function updateGuestCapabilities(
  owner: Account,
  targetId: string,
  capabilities: string[],
): Promise<Account> {
  if (owner.type !== "owner") throw forbidden("Only the owner can manage accounts");
  const capError = validateCapabilityAssignment(capabilities);
  if (capError) throw badRequest(capError);
  const normalizedCapabilities = normalizeCapabilities(capabilities);
  return withWriteLock(async () => {
    const target = await getAccount(targetId);
    if (!target) throw notFound("Account not found");
    if (target.type !== "guest") throw badRequest("Only guest accounts have assignable capabilities");
    const updated: Account = {
      ...target,
      capabilities: normalizedCapabilities as GuestCapability[],
      sessionVersion: target.sessionVersion + 1,
      updatedAt: nowIso(),
    };
    await saveAccount(updated);
    await audit({
      type: "account.capabilities.changed",
      actorAccountId: owner.id,
      clientAddress: null,
      detail: { accountId: target.id, username: target.username, capabilities: updated.capabilities },
    });
    return updated;
  });
}

export async function listAllAccounts(): Promise<Account[]> {
  const accounts = await listAccounts();
  return accounts.sort((a, b) => a.username.localeCompare(b.username));
}
