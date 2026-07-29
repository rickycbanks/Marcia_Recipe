import { apiHandler, jsonOk } from "@/lib/api";
import { requireOwner } from "@/lib/authorization/guards";
import { createBackup, listBackups } from "@/lib/backups/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Owner-only: list existing backups (metadata only, no paths). */
export const GET = apiHandler(async () => {
  await requireOwner();
  const backups = await listBackups();
  return jsonOk({ backups });
});

/** Owner-only: create a new consistent archive under the global write lock. */
export const POST = apiHandler(async () => {
  const owner = await requireOwner();
  const backup = await createBackup(owner);
  return jsonOk({ backup }, { status: 201 });
});
