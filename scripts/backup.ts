#!/usr/bin/env tsx
/**
 * Create a full-site backup archive (same engine as the web UI).
 * Usage: npm run cli:backup -- [--data-root /data/marcia-recipe]
 */
import { applyDataRootFlag, parseArgs } from "./lib";

const { flags } = parseArgs(process.argv.slice(2));
applyDataRootFlag(flags);

const { ensureDataRoot } = await import("@/lib/storage/dataRoot");
const { createBackup } = await import("@/lib/backups/service");

try {
  await ensureDataRoot();
  const backup = await createBackup(null);
  console.log(`Backup created: backups/${backup.fileName} (${(backup.bytes / 1024).toFixed(1)} KB)`);
} catch (err) {
  console.error(`Backup failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
