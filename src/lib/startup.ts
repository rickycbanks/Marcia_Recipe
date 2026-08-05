import { audit } from "@/lib/audit/log";
import { rotateAuditLogs } from "@/lib/audit/log";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { cleanupOrphanedTmpFiles, ensureDataRoot } from "@/lib/storage/dataRoot";
import { getSearchIndex } from "@/lib/storage/indexes";
import { withLock } from "@/lib/storage/lock";
import { getSiteConfig } from "@/lib/storage/repositories/config";

let ran = false;

/**
 * Startup integrity checks (instrumentation.ts → Node runtime only):
 * - environment validation (AUTH_SECRET required in production)
 * - DATA_ROOT existence, layout and writability — clear error when broken
 * - sweep orphaned temp files from interrupted atomic writes
 * - heal derived data (search index rebuilds when missing)
 * - bounded audit-log rotation
 */
export async function runStartupChecks(): Promise<void> {
  if (ran) return;
  ran = true;
  const env = getEnv(); // throws CONFIG_INVALID with an actionable message
  await ensureDataRoot();
  const config = await withLock("root-swap", async () => {
    await cleanupOrphanedTmpFiles();
    const loaded = await getSiteConfig(); // quarantines malformed config, falls back to defaults
    await getSearchIndex(); // rebuilds derived index when missing/corrupt
    await rotateAuditLogs();
    return loaded;
  });
  await audit({
    type: "settings.updated",
    actorAccountId: null,
    clientAddress: null,
    detail: { event: "startup", nodeEnv: env.NODE_ENV, setupCompleted: config.setupCompletedAt !== null },
  });
  logger.info("Startup checks passed", { dataRoot: env.DATA_ROOT, nodeEnv: env.NODE_ENV });
}
