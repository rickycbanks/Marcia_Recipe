#!/usr/bin/env tsx
/**
 * Create the first owner from the command line (alternative to web setup).
 * Usage: npm run cli:create-owner -- --username marcia --display-name "Marcia" [--password ...] [--data-root /data/marcia-recipe]
 */
import { applyDataRootFlag, parseArgs, promptSecret, requireFlag } from "./lib";

const { flags } = parseArgs(process.argv.slice(2));
applyDataRootFlag(flags);

const { createOwnerViaCli } = await import("@/lib/accounts/service");

const username = requireFlag(flags, "username");
const displayName = requireFlag(flags, "display-name");
const password = flags.password ?? (await promptSecret("Owner password (min 10 chars): "));

try {
  const owner = await createOwnerViaCli({ username, displayName, password });
  console.log(`Owner account created: @${owner.username} (${owner.displayName})`);
  console.log("Web setup is now permanently disabled.");
} catch (err) {
  console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
