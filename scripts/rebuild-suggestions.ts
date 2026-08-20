#!/usr/bin/env tsx
/**
 * Rebuild the suggestion index from canonical recipe data (safe to run any time).
 * Usage: npm run cli:rebuild-suggestions -- [--data-root /data/marcia-recipe]
 */
import { applyDataRootFlag, parseArgs } from "./lib";

const { flags } = parseArgs(process.argv.slice(2));
applyDataRootFlag(flags);

const { ensureDataRoot } = await import("@/lib/storage/dataRoot");
const { rebuildSuggestionIndex } = await import("@/lib/storage/indexes");

await ensureDataRoot();
const index = await rebuildSuggestionIndex();
console.log(
  `Suggestion index rebuilt: ${index.categories.length} categories, ${index.tags.length} tags, ${index.bookTitles.length} book titles, ${index.bookAuthors.length} book authors.`,
);
