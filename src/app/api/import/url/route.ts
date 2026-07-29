import { z } from "zod";
import { apiHandler, jsonOk, parseBody } from "@/lib/api";
import { requireCapability } from "@/lib/authorization/guards";
import { importRecipeFromUrl } from "@/lib/imports/service";
import { httpUrlSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ url: httpUrlSchema });

/**
 * Owner-only URL import. Returns a DRAFT for owner review — this endpoint
 * never persists anything.
 */
export const POST = apiHandler(async (request) => {
  const owner = await requireCapability("recipes.import");
  const { url } = await parseBody(request, bodySchema);
  const result = await importRecipeFromUrl(owner, url);
  return jsonOk(result);
});
