import { z } from "zod";
import { apiHandler, jsonOk, parseBody } from "@/lib/api";
import { setupFirstOwner } from "@/lib/accounts/service";
import { anyOwnerExists } from "@/lib/storage/repositories/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  token: z.string().min(1),
  username: z.string().min(1),
  displayName: z.string().min(1),
  password: z.string().min(1),
});

/** First-run owner setup. Permanently disabled once an owner exists. */
export const POST = apiHandler(async (request) => {
  const body = await parseBody(request, bodySchema);
  const owner = await setupFirstOwner(body);
  return jsonOk({ ok: true, username: owner.username }, { status: 201 });
});

/** Lets the UI know whether setup is still available. */
export const GET = apiHandler(async () => {
  return jsonOk({ setupAvailable: !(await anyOwnerExists()) });
});
