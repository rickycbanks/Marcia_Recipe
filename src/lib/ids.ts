import { randomBytes, randomUUID } from "node:crypto";
import { slugSchema, uuidSchema, weekIdSchema } from "./validation/schemas";
import { badRequest } from "./errors";

export const newId = (): string => randomUUID();

/** URL-safe high-entropy token used for invitation secrets. */
export function newSecret(byteLength = 24): string {
  return randomBytes(byteLength).toString("base64url");
}

/** Validate an untrusted value as a UUID before it touches the filesystem. */
export function assertUuid(value: unknown, label = "id"): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw badRequest(`Invalid ${label}`);
  return parsed.data;
}

/** Validate an untrusted value as a slug before it touches the filesystem. */
export function assertSlug(value: unknown): string {
  const parsed = slugSchema.safeParse(value);
  if (!parsed.success) throw badRequest("Invalid slug");
  return parsed.data;
}

/** Validate an untrusted value as an ISO week id (e.g. 2026-W30). */
export function assertWeekId(value: unknown): string {
  const parsed = weekIdSchema.safeParse(value);
  if (!parsed.success) throw badRequest("Invalid week identifier");
  return parsed.data;
}

/** Convert an arbitrary title into a valid slug base (without uniqueness suffix). */
export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/^-+|-+$/g, "");
  return base.length > 0 ? base : "recipe";
}
