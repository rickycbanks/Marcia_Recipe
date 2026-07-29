import { apiHandler, jsonOk } from "@/lib/api";
import { assertUuid } from "@/lib/ids";
import { requireOwner } from "@/lib/authorization/guards";
import { cancelInvitation } from "@/lib/invitations/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

/** Owner-only invitation cancellation. */
export const DELETE = apiHandler(async (_request, { params }: Params) => {
  const owner = await requireOwner();
  const { id } = await params;
  await cancelInvitation(owner, assertUuid(id));
  return jsonOk({ ok: true });
});
