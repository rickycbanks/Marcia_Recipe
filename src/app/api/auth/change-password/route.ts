import { z } from "zod";
import { apiHandler, jsonOk, parseBody } from "@/lib/api";
import { requireSession } from "@/lib/authorization/guards";
import { changePassword } from "@/lib/accounts/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

/** Self-service password change; invalidates all sessions (incl. this one). */
export const POST = apiHandler(async (request) => {
  const account = await requireSession();
  const body = await parseBody(request, bodySchema);
  await changePassword(account, body.currentPassword, body.newPassword);
  return jsonOk({ ok: true });
});
