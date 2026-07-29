import { z } from "zod";
import { apiHandler, jsonOk, parseBody } from "@/lib/api";
import { clientAddress } from "@/lib/auth/rateLimit";
import { acceptInvitation } from "@/lib/invitations/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const acceptSchema = z.object({
  invitationId: z.string().min(1),
  secret: z.string().min(1),
  username: z.string().min(1),
  displayName: z.string().min(1),
  password: z.string().min(1),
});

/**
 * Public endpoint: accepts an invitation and creates the guest account.
 * Single-use enforced atomically; rate-limited by client address.
 */
export const POST = apiHandler(async (request) => {
  const body = await parseBody(request, acceptSchema);
  const account = await acceptInvitation({ ...body, clientAddress: clientAddress(request) });
  return jsonOk({ ok: true, username: account.username }, { status: 201 });
});
