import type { Account, Invitation } from "@/types";
import { audit } from "@/lib/audit/log";
import { conflict, gone, notFound, rateLimited } from "@/lib/errors";
import { newId, newSecret } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { INVITE_RATE_LIMIT, SCHEMA_VERSIONS } from "@/lib/validation/constants";
import type { GuestCapability } from "@/lib/validation/constants";
import { hashPassword } from "@/lib/auth/passwords";
import { hashToken, safeEqual } from "@/lib/auth/tokens";
import { checkRateLimit } from "@/lib/auth/rateLimit";
import { normalizeCapabilities, validateCapabilityAssignment } from "@/lib/authorization/capabilities";
import { withWriteLock } from "@/lib/storage/lock";
import {
  findAccountByUsername,
  normalizeUsername,
  saveAccount,
} from "@/lib/storage/repositories/accounts";
import { getInvitation, listInvitations, saveInvitation } from "@/lib/storage/repositories/invitations";
import { displayNameSchema, passwordSchema, usernameSchema } from "@/lib/validation/schemas";

const DEFAULT_EXPIRY_DAYS = 7;

/** Owner creates a single-use invitation. The raw secret is returned ONCE. */
export async function createInvitation(
  owner: Account,
  capabilities: string[],
  expiresInDays: number = DEFAULT_EXPIRY_DAYS,
): Promise<{ invitation: Invitation; url: string }> {
  if (owner.type !== "owner") throw conflict("Only the owner can create invitations");
  const capError = validateCapabilityAssignment(capabilities);
  if (capError) throw conflict(capError);
  const normalizedCapabilities = normalizeCapabilities(capabilities);
  return withWriteLock(async () => {
    const secret = newSecret(24);
    const now = nowIso();
    const invitation: Invitation = {
      schemaVersion: SCHEMA_VERSIONS.invitation,
      id: newId(),
      secretHash: hashToken(secret),
      capabilities: normalizedCapabilities as GuestCapability[],
      expiresAt: new Date(Date.now() + expiresInDays * 86_400_000).toISOString(),
      issuedBy: owner.id,
      issuedAt: now,
      status: "pending",
      acceptedAccountId: null,
      acceptedAt: null,
    };
    await saveInvitation(invitation);
    await audit({
      type: "invitation.created",
      actorAccountId: owner.id,
      clientAddress: null,
      detail: { invitationId: invitation.id, capabilities: invitation.capabilities, expiresAt: invitation.expiresAt },
    });
    return { invitation, url: `/invite/${invitation.id}/${secret}` };
  });
}

export async function cancelInvitation(owner: Account, invitationId: string): Promise<void> {
  if (owner.type !== "owner") throw conflict("Only the owner can cancel invitations");
  await withWriteLock(async () => {
    const invitation = await getInvitation(invitationId);
    if (!invitation) throw notFound("Invitation not found");
    if (invitation.status !== "pending") throw conflict("Only pending invitations can be cancelled");
    await saveInvitation({ ...invitation, status: "cancelled" });
    await audit({
      type: "invitation.cancelled",
      actorAccountId: owner.id,
      clientAddress: null,
      detail: { invitationId },
    });
  });
}

export interface AcceptInvitationInput {
  invitationId: string;
  secret: string;
  username: string;
  displayName: string;
  password: string;
  clientAddress: string;
}

/** Read-only preview for the acceptance page (does not consume the invitation). */
export async function previewInvitation(
  invitationId: string,
  secret: string,
): Promise<{ valid: boolean; capabilities: string[]; expiresAt: string | null }> {
  const invitation = await getInvitation(invitationId);
  if (!invitation || invitation.status !== "pending") return { valid: false, capabilities: [], expiresAt: null };
  if (!safeEqual(hashToken(secret), invitation.secretHash)) return { valid: false, capabilities: [], expiresAt: null };
  if (Date.parse(invitation.expiresAt) <= Date.now()) return { valid: false, capabilities: [], expiresAt: invitation.expiresAt };
  return { valid: true, capabilities: invitation.capabilities, expiresAt: invitation.expiresAt };
}

/**
 * Atomically accept an invitation and create the guest account. The write
 * lock serializes acceptance so an invitation can never be accepted twice;
 * a crash between account creation and invitation completion is recoverable
 * (retrying with the same username resumes via createdViaInvitationId).
 */
export async function acceptInvitation(input: AcceptInvitationInput): Promise<Account> {
  const limit = checkRateLimit(
    `invite:${input.clientAddress}`,
    INVITE_RATE_LIMIT.maxAttempts,
    INVITE_RATE_LIMIT.windowMs,
  );
  if (!limit.allowed) throw rateLimited();

  const usernameResult = usernameSchema.safeParse(normalizeUsername(input.username));
  if (!usernameResult.success) throw conflict(usernameResult.error.issues[0]?.message ?? "Invalid username");
  const displayNameResult = displayNameSchema.safeParse(input.displayName);
  if (!displayNameResult.success) throw conflict(displayNameResult.error.issues[0]?.message ?? "Invalid display name");
  const passwordResult = passwordSchema.safeParse(input.password);
  if (!passwordResult.success) throw conflict(passwordResult.error.issues[0]?.message ?? "Invalid password");
  const username = usernameResult.data;
  const displayName = displayNameResult.data;

  return withWriteLock(async () => {
    const invitation = await getInvitation(input.invitationId);
    if (!invitation) throw notFound("Invitation not found");
    if (invitation.status === "accepted") throw gone("This invitation has already been used");
    if (invitation.status === "cancelled") throw gone("This invitation was cancelled");
    if (Date.parse(invitation.expiresAt) <= Date.now()) throw gone("This invitation has expired");
    if (!safeEqual(hashToken(input.secret), invitation.secretHash)) {
      throw notFound("Invitation not found"); // do not leak which part was wrong
    }

    const now = nowIso();
    let account = await findAccountByUsername(username);
    if (account) {
      // Crash-recovery: the account exists from an earlier interrupted acceptance
      // of THIS invitation — resume and complete the invitation instead of failing.
      if (account.createdViaInvitationId !== invitation.id) {
        throw conflict("That username is already taken");
      }
    } else {
      account = {
        schemaVersion: SCHEMA_VERSIONS.account,
        id: newId(),
        username,
        displayName,
        password: await hashPassword(input.password),
        type: "guest",
        capabilities: invitation.capabilities,
        sessionVersion: 1,
        disabledAt: null,
        createdViaInvitationId: invitation.id,
        createdAt: now,
        updatedAt: now,
      };
      await saveAccount(account);
    }

    await saveInvitation({
      ...invitation,
      status: "accepted",
      acceptedAccountId: account.id,
      acceptedAt: now,
    });
    await audit({
      type: "invitation.accepted",
      actorAccountId: account.id,
      clientAddress: input.clientAddress,
      detail: { invitationId: invitation.id },
    });
    await audit({
      type: "account.created",
      actorAccountId: account.id,
      clientAddress: input.clientAddress,
      detail: { accountId: account.id, username: account.username, via: "invitation" },
    });
    return account;
  });
}

export async function listAllInvitations(): Promise<Invitation[]> {
  return listInvitations();
}
