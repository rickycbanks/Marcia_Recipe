import { z } from "zod";
import { apiHandler, jsonOk, parseBody } from "@/lib/api";
import { badRequest } from "@/lib/errors";
import { assertUuid } from "@/lib/ids";
import { requireOwner } from "@/lib/authorization/guards";
import { setAccountDisabled, updateGuestCapabilities } from "@/lib/accounts/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("setDisabled"), disabled: z.boolean() }),
  z.object({ action: z.literal("setCapabilities"), capabilities: z.array(z.string()) }),
]);

/** Owner-only account administration. Takes effect immediately. */
export const PATCH = apiHandler(async (request, { params }: Params) => {
  const owner = await requireOwner();
  const { id } = await params;
  const body = await parseBody(request, patchSchema);
  const accountId = assertUuid(id);
  if (body.action === "setDisabled") {
    const account = await setAccountDisabled(owner, accountId, body.disabled);
    return jsonOk({ ok: true, disabled: account.disabledAt !== null });
  }
  if (body.action === "setCapabilities") {
    const account = await updateGuestCapabilities(owner, accountId, body.capabilities);
    return jsonOk({ ok: true, capabilities: account.capabilities });
  }
  throw badRequest("Unknown action");
});
