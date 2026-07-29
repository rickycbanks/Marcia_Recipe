import { z } from "zod";
import { apiHandler, jsonOk, parseBody } from "@/lib/api";
import { requireOwner } from "@/lib/authorization/guards";
import { createInvitation } from "@/lib/invitations/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  capabilities: z.array(z.string()).default([]),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

/** Owner-only invitation creation. The raw secret URL is returned ONCE. */
export const POST = apiHandler(async (request) => {
  const owner = await requireOwner();
  const body = await parseBody(request, createSchema);
  const { invitation, url } = await createInvitation(owner, body.capabilities, body.expiresInDays);
  return jsonOk({ invitationId: invitation.id, url, expiresAt: invitation.expiresAt }, { status: 201 });
});
