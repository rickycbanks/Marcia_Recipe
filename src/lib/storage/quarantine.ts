import { rename, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { logger } from "@/lib/logger";

export interface QuarantineRecord {
  originalPath: string;
  quarantinePath: string;
  reason: string;
  at: string;
}

/**
 * Move a malformed canonical document aside so the application keeps running
 * and the owner gets an actionable report. The original file is renamed next
 * to a report file describing why.
 */
export async function quarantineFile(absPath: string, reason: string): Promise<string | null> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const quarantinePath = `${absPath}.corrupt-${stamp}`;
  try {
    await rename(absPath, quarantinePath);
    const report: QuarantineRecord = {
      originalPath: basename(absPath),
      quarantinePath,
      reason,
      at: new Date().toISOString(),
    };
    await writeFile(`${quarantinePath}.report.json`, JSON.stringify(report, null, 2));
    logger.error("Quarantined malformed document", report);
    return quarantinePath;
  } catch (err) {
    logger.error("Failed to quarantine malformed document", { absPath, reason, error: String(err) });
    return null;
  }
}
