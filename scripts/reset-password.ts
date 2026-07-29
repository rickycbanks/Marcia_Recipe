#!/usr/bin/env tsx
/**
 * Reset an account password locally (lockout recovery for the owner).
 * Usage: npm run cli:reset-password -- --username marcia [--password ...] [--data-root /data/marcia-recipe]
 */
import { applyDataRootFlag, parseArgs, promptSecret, requireFlag } from "./lib";

const { flags } = parseArgs(process.argv.slice(2));
applyDataRootFlag(flags);

const { resetPasswordViaCli } = await import("@/lib/accounts/service");

const username = requireFlag(flags, "username");
const password = flags.password ?? (await promptSecret("New password (min 10 chars): "));

try {
  await resetPasswordViaCli(username, password);
  console.log(`Password reset for @${username}. All previous sessions were invalidated.`);
} catch (err) {
  console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
