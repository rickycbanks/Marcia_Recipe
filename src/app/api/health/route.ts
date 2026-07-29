import { apiHandler, jsonOk } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness: process is up (no filesystem access). */
export const GET = apiHandler(async () => {
  return jsonOk({ status: "ok" });
});
