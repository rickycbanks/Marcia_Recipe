import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { apiHandler } from "@/lib/api";
import { notFound } from "@/lib/errors";
import { requireOwner } from "@/lib/authorization/guards";
import { backupFilePath } from "@/lib/backups/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ file: string }>;
}

/** Owner-only backup download (file name strictly validated, no traversal). */
export const GET = apiHandler(async (_request, { params }: Params) => {
  await requireOwner();
  const { file } = await params;
  const path = backupFilePath(file);
  const info = await stat(path).catch(() => null);
  if (!info) throw notFound("Backup not found");
  const stream = Readable.toWeb(createReadStream(path));
  return new Response(stream as ReadableStream, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Length": String(info.size),
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
});
