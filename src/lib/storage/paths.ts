import { resolve, sep } from "node:path";
import { badRequest } from "@/lib/errors";
import { getDataRoot } from "./dataRoot";

/**
 * Resolve path segments beneath DATA_ROOT and verify the result cannot escape
 * it (defends against traversal even if a caller forgets to validate ids).
 */
export function resolveWithinDataRoot(...segments: string[]): string {
  const root = getDataRoot();
  const resolved = resolve(root, ...segments);
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw badRequest("Path escapes DATA_ROOT");
  }
  return resolved;
}

/** Resolve within a specific subdirectory, e.g. resolveWithin("recipes", id, "recipe.json"). */
export function resolveWithin(base: string, ...segments: string[]): string {
  return resolveWithinDataRoot(base, ...segments);
}

const UNSAFE_SEGMENT = /[/\\\0-\x1f\x7f]/;

/**
 * Guard a single path segment that will be used verbatim in the filesystem.
 * Rejects separators, dot segments, NULs and control characters outright.
 */
export function assertSafeSegment(value: unknown, label = "path segment"): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 255 ||
    value === "." ||
    value === ".." ||
    UNSAFE_SEGMENT.test(value)
  ) {
    throw badRequest(`Invalid ${label}`);
  }
  return value;
}
