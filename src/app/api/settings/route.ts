import { apiHandler, jsonOk, parseBody } from "@/lib/api";
import { audit } from "@/lib/audit/log";
import { requireOwner } from "@/lib/authorization/guards";
import { siteConfigPatchSchema } from "@/lib/validation/schemas";
import { getSiteConfig, saveSiteConfig } from "@/lib/storage/repositories/config";
import { withWriteLock } from "@/lib/storage/lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public-safe site settings (name/theme/visibility default are not sensitive). */
export const GET = apiHandler(async () => {
  const config = await getSiteConfig();
  return jsonOk({
    siteName: config.siteName,
    defaultVisibility: config.defaultVisibility,
    theme: config.theme,
  });
});

/** Owner-only settings update. */
export const PATCH = apiHandler(async (request) => {
  const owner = await requireOwner();
  const patch = await parseBody(request, siteConfigPatchSchema);
  await withWriteLock(async () => {
    const config = await getSiteConfig();
    await saveSiteConfig({ ...config, ...patch });
  });
  await audit({
    type: "settings.updated",
    actorAccountId: owner.id,
    clientAddress: null,
    detail: { keys: Object.keys(patch) },
  });
  return jsonOk({ ok: true });
});
