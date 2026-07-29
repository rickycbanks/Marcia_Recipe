import { apiHandler, jsonOk } from "@/lib/api";
import { ensureDataRoot } from "@/lib/storage/dataRoot";
import { getSiteConfig } from "@/lib/storage/repositories/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Readiness: DATA_ROOT writable and config loadable. */
export const GET = apiHandler(async () => {
  await ensureDataRoot();
  await getSiteConfig();
  return jsonOk({ status: "ready" });
});
