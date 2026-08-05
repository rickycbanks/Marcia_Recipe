import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { AuditEvent } from "@/types";
import { logger } from "@/lib/logger";
import { withLock } from "@/lib/storage/lock";
import { resolveWithin } from "@/lib/storage/paths";

/** Bounded rotation: monthly files, keep the most recent N. */
const MAX_AUDIT_FILES = 24;

function auditFileName(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `audit-${y}${m}.jsonl`;
}

/**
 * Append a security/audit event. Events never contain secrets — callers pass
 * only pre-sanitized detail (usernames, ids, capability names, counts).
 */
export async function audit(event: Omit<AuditEvent, "at">): Promise<void> {
  try {
    await withLock("root-swap", async () => {
      const dir = resolveWithin("audit");
      await mkdir(dir, { recursive: true });
      const line = JSON.stringify({ ...event, at: new Date().toISOString() }) + "\n";
      await appendFile(join(dir, auditFileName()), line, "utf8");
    });
  } catch (err) {
    // Auditing must never break the operation being audited.
    logger.error("Failed to write audit event", { type: event.type, error: String(err) });
  }
}

/** Delete audit files beyond the retention bound (oldest first). */
export async function rotateAuditLogs(): Promise<void> {
  try {
    const dir = resolveWithin("audit");
    const files = (await readdir(dir)).filter((f) => f.startsWith("audit-") && f.endsWith(".jsonl"));
    if (files.length <= MAX_AUDIT_FILES) return;
    const withMtime = await Promise.all(
      files.map(async (f) => ({ f, mtime: (await stat(join(dir, f))).mtimeMs })),
    );
    withMtime.sort((a, b) => a.mtime - b.mtime);
    for (const old of withMtime.slice(0, files.length - MAX_AUDIT_FILES)) {
      await unlink(join(dir, old.f)).catch(() => undefined);
    }
  } catch (err) {
    logger.warn("Audit rotation failed", { error: String(err) });
  }
}
