import { open, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { apiHandler, jsonOk } from "@/lib/api";
import { requireOwner } from "@/lib/authorization/guards";
import { restoreBackup } from "@/lib/backups/restore";
import { badRequest, payloadTooLarge } from "@/lib/errors";
import { resolveWithin } from "@/lib/storage/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Upper bound for a compressed .tar.gz restore upload. The restore library
 * applies stricter per-entry and total decompression budgets during
 * extraction, so this cap only bounds the buffered upload itself and prevents
 * memory exhaustion before any bytes are written to disk.
 */
const MAX_RESTORE_UPLOAD_BYTES = 512 * 1024 * 1024;

/** Owner-only restore from a multipart .tar.gz backup upload. */
export const POST = apiHandler(async (request) => {
  const owner = await requireOwner();

  // Bound the upload before the body is read. The content-length header is a
  // hint; the streaming write below enforces the same cap byte-for-byte.
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_RESTORE_UPLOAD_BYTES) {
    throw payloadTooLarge("Backup upload too large");
  }

  const form = await request.formData().catch(() => {
    throw badRequest("Expected multipart form data");
  });

  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Missing backup file");
  if (!file.name.toLowerCase().endsWith(".tar.gz")) {
    throw badRequest("Backup file must be a .tar.gz archive");
  }

  const forceRaw = form.get("force");
  const force = forceRaw === "true" || forceRaw === "1";

  const tempRoot = resolveWithin("tmp");
  await mkdir(tempRoot, { recursive: true });
  const tempDirectory = await mkdtemp(join(tempRoot, "restore-upload-"));
  const tempPath = join(tempDirectory, "backup.tar.gz");
  try {
    // Stream the upload to disk instead of buffering it in memory, aborting as
    // soon as the size cap is exceeded.
    const handle = await open(tempPath, "wx", 0o600);
    let total = 0;
    try {
      for await (const chunk of Readable.fromWeb(file.stream() as unknown as NodeReadableStream)) {
        total += chunk.byteLength;
        if (total > MAX_RESTORE_UPLOAD_BYTES) {
          throw payloadTooLarge("Backup upload too large");
        }
        await handle.writeFile(chunk);
      }
    } finally {
      await handle.close();
    }
    if (total > MAX_RESTORE_UPLOAD_BYTES) {
      throw payloadTooLarge("Backup upload too large");
    }

    // The safety backup is created inside the library under the backup/write
    // locks; do not create a separate pre-lock snapshot here. Passing the real
    // owner lets the library's audit record the actual actor.
    const restore = await restoreBackup(tempPath, { force, actor: owner });
    return jsonOk({ restore });
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
