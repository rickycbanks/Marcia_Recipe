#!/usr/bin/env tsx
/**
 * Rebuild all derived indexes from canonical data (safe to run any time).
 * Usage: npm run cli:rebuild-indexes -- [--data-root /data/marcia-recipe]
 */
import { applyDataRootFlag, parseArgs } from "./lib";

const { flags } = parseArgs(process.argv.slice(2));
applyDataRootFlag(flags);

const { ensureDataRoot } = await import("@/lib/storage/dataRoot");
const { rebuildSearchIndex } = await import("@/lib/storage/indexes");

await ensureDataRoot();
const index = await rebuildSearchIndex();
console.log(`Search index rebuilt: ${index.entries.length} recipes, ${Object.keys(index.slugToId).length} slugs/aliases.`);
