import { apiHandler } from "@/lib/api";
import { notFound } from "@/lib/errors";
import { assertUuid } from "@/lib/ids";
import { getSessionAccount } from "@/lib/authorization/guards";
import { authorizeMediaAccess, readMediaFile } from "@/lib/media/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ recipeId: string; mediaId: string }>;
}

/**
 * Every media request is authorized against its recipe's visibility. Protected
 * media is served with private/no-store headers and the internal storage path
 * never appears in any response.
 */
export const GET = apiHandler(async (_request, { params }: Params) => {
  const { recipeId, mediaId } = await params;
  const account = await getSessionAccount();
  const media = await authorizeMediaAccess(account, assertUuid(recipeId), assertUuid(mediaId));
  if (!media) throw notFound("Media not found");

  const bytes = await readMediaFile(media);
  const cacheControl = media.isPublic
    ? "public, max-age=0, must-revalidate"
    : "private, no-cache, no-store, must-revalidate";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(media.bytes),
      "Cache-Control": cacheControl,
      ETag: `"${mediaId}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
});
