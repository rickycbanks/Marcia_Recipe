import type { Invitation } from "@/types";
import { assertUuid } from "@/lib/ids";
import { invitationSchema } from "@/lib/validation/schemas";
import { readJson, writeJsonAtomic } from "../atomic";
import { resolveWithin } from "../paths";
import { listDocuments } from "../repo";

const invitationsDir = () => resolveWithin("invitations");
const invitationPath = (id: string) =>
  resolveWithin("invitations", `${assertUuid(id, "invitation id")}.json`);

export async function getInvitation(id: string): Promise<Invitation | null> {
  return readJson(invitationPath(id), invitationSchema);
}

export async function listInvitations(): Promise<Invitation[]> {
  const invitations = await listDocuments(invitationsDir(), invitationSchema);
  return invitations.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
}

/** Write under the caller's lock — acceptance must be atomic with account creation. */
export async function saveInvitation(invitation: Invitation): Promise<void> {
  await writeJsonAtomic(invitationPath(invitation.id), invitationSchema.parse(invitation));
}
