#!/usr/bin/env tsx
/**
 * Restore a backup archive with validation and dry-run support.
 * Usage: npm run cli:restore -- --file backups/<archive>.tar.gz [--dry-run] [--force] [--data-root /data/marcia-recipe]
 */
import { isAbsolute, resolve } from "node:path";
import { applyDataRootFlag, parseArgs, requireFlag } from "./lib";

const { flags, booleans } = parseArgs(process.argv.slice(2));
applyDataRootFlag(flags);

const { ensureDataRoot, getDataRoot } = await import("@/lib/storage/dataRoot");
const { restoreBackup } = await import("@/lib/backups/restore");

const fileArg = requireFlag(flags, "file");
const archivePath = isAbsolute(fileArg) ? fileArg : resolve(getDataRoot(), fileArg);
const dryRun = booleans.has("dry-run");
const force = booleans.has("force");

try {
  await ensureDataRoot();
  const report = await restoreBackup(archivePath, { dryRun, force });
  console.log("Restore report:");
  console.log(`  backup created:       ${report.manifest.createdAt}`);
  console.log(`  archive entries:      ${report.entries}`);
  console.log(`  JSON docs validated:  ${report.jsonDocumentsValidated}`);
  console.log(`  media files:          ${report.mediaFiles}`);
  if (report.problems.length > 0) {
    console.error("  PROBLEMS:");
    for (const problem of report.problems) console.error(`    - ${problem}`);
    process.exit(1);
  }
  if (dryRun) {
    console.log("  (dry run — nothing was written; re-run without --dry-run to restore)");
  } else if (report.restored) {
    console.log("  Restore complete. Derived indexes were rebuilt.");
  }
} catch (err) {
  console.error(`Restore failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
