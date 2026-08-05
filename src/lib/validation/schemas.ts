import { z } from "zod";
import {
  BOOK_AUTHOR_MAX_LENGTH,
  BOOK_PAGE_MAX,
  BOOK_TITLE_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  GUEST_CAPABILITIES,
  MAX_INGREDIENTS,
  MAX_LIST_ITEMS,
  MAX_STEPS,
  MAX_TAGS,
  MEAL_SLOTS,
  PASSWORD_MIN_LENGTH,
  SITE_DEFAULT_VISIBILITIES,
  SLUG_MAX_LENGTH,
  THEMES,
  TITLE_MAX_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  VISIBILITIES,
} from "./constants";

/* ---------------------------------- shared ---------------------------------- */

export const uuidSchema = z.uuid();
export const isoDateTimeSchema = z.iso.datetime();
export const weekIdSchema = z.string().regex(/^\d{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$/, "Invalid ISO week id");

export const slugSchema = z
  .string()
  .min(1)
  .max(SLUG_MAX_LENGTH)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase words separated by hyphens");

export const usernameSchema = z
  .string()
  .min(USERNAME_MIN_LENGTH)
  .max(USERNAME_MAX_LENGTH)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Username may contain lowercase letters, digits, dot, dash, underscore");

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(256);

export const displayNameSchema = z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH);

/** Recipe source links may never be executable or browser-local schemes. */
export const httpUrlSchema = z.url().refine(
  (value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  },
  "URL must use http or https",
);

export const capabilitySchema = z.enum(GUEST_CAPABILITIES);

/** scrypt$N$r$p$salt_b64$hash_b64 — parameters are pinned so future rehashes stay verifiable. */
export const passwordRecordSchema = z.object({
  algo: z.literal("scrypt"),
  N: z.number().int().positive(),
  r: z.number().int().positive(),
  p: z.number().int().positive(),
  salt: z.string().min(1),
  hash: z.string().min(1),
});

/* ---------------------------------- account --------------------------------- */

export const accountSchema = z.object({
  schemaVersion: z.literal(1),
  id: uuidSchema,
  username: usernameSchema,
  displayName: displayNameSchema,
  password: passwordRecordSchema,
  type: z.enum(["owner", "guest"]),
  capabilities: z.array(capabilitySchema),
  sessionVersion: z.number().int().nonnegative(),
  disabledAt: isoDateTimeSchema.nullable(),
  /** Set when the account was created by accepting an invitation (crash recovery aid). */
  createdViaInvitationId: uuidSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

/* --------------------------------- invitation -------------------------------- */

export const invitationSchema = z.object({
  schemaVersion: z.literal(1),
  id: uuidSchema,
  /** SHA-256 hex digest of the URL secret; the raw secret is only ever shown once. */
  secretHash: z.string().regex(/^[a-f0-9]{64}$/),
  capabilities: z.array(capabilitySchema),
  expiresAt: isoDateTimeSchema,
  issuedBy: uuidSchema,
  issuedAt: isoDateTimeSchema,
  status: z.enum(["pending", "accepted", "cancelled"]),
  acceptedAccountId: uuidSchema.nullable(),
  acceptedAt: isoDateTimeSchema.nullable(),
});

/* ---------------------------------- recipe ---------------------------------- */

export const ingredientSchema = z.object({
  id: uuidSchema,
  order: z.number().int().nonnegative(),
  quantity: z.number().nonnegative().nullable(),
  unit: z.string().trim().max(30).nullable(),
  name: z.string().trim().min(1).max(200),
  note: z.string().trim().max(200).nullable(),
});

export const recipeStepSchema = z.object({
  id: uuidSchema,
  order: z.number().int().nonnegative(),
  text: z.string().trim().min(1).max(2000),
});

export const mediaItemSchema = z.object({
  id: uuidSchema,
  fileName: z.string().regex(/^[0-9a-f-]+\.webp$/),
  alt: z.string().trim().max(200),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
  isPrimary: z.boolean(),
  createdAt: isoDateTimeSchema,
});

/**
 * Server-generated sidecar for a staged (not yet attached) media upload.
 * Short-lived scratch metadata kept beside the .webp in tmp/staged-media;
 * swept by cleanupOrphanedTmpFiles after the TTL.
 */
export const stagedMediaItemSchema = mediaItemSchema.extend({
  ownerAccountId: uuidSchema,
});

export const recipeSchema = z
  .object({
    schemaVersion: z.literal(2),
    id: uuidSchema,
    slug: slugSchema,
    previousSlugs: z.array(slugSchema),
    visibility: z.enum(VISIBILITIES),
    title: z.string().trim().min(1).max(TITLE_MAX_LENGTH),
    description: z.string().trim().max(DESCRIPTION_MAX_LENGTH),
    prepMinutes: z.number().int().nonnegative().nullable(),
    cookMinutes: z.number().int().nonnegative().nullable(),
    servings: z.number().positive().nullable(),
    difficulty: z.enum(["easy", "medium", "hard"]).nullable(),
    category: z.string().trim().max(60).nullable(),
    tags: z.array(z.string().trim().min(1).max(40)).max(MAX_TAGS),
     sourceUrl: httpUrlSchema.nullable(),
    bookTitle: z.string().trim().max(BOOK_TITLE_MAX_LENGTH).nullable(),
    bookAuthor: z.string().trim().max(BOOK_AUTHOR_MAX_LENGTH).nullable(),
    bookPage: z.number().int().positive().max(BOOK_PAGE_MAX).nullable(),
    ingredients: z.array(ingredientSchema).max(MAX_INGREDIENTS),
    steps: z.array(recipeStepSchema).max(MAX_STEPS),
    notesMarkdown: z.string().max(20_000),
    media: z.array(mediaItemSchema),
    archivedAt: isoDateTimeSchema.nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .superRefine((recipe, ctx) => {
    const ingredientOrders = recipe.ingredients.map((i) => i.order);
    if (new Set(ingredientOrders).size !== ingredientOrders.length) {
      ctx.addIssue({ code: "custom", message: "Ingredient ordering must be unique", path: ["ingredients"] });
    }
    const stepOrders = recipe.steps.map((s) => s.order);
    if (new Set(stepOrders).size !== stepOrders.length) {
      ctx.addIssue({ code: "custom", message: "Step ordering must be unique", path: ["steps"] });
    }
  });

/**
 * Editable recipe payload accepted by create/update endpoints. The server
 * assigns ids/order; clients send plain content fields.
 */
export const recipeDraftSchema = z.object({
  slug: slugSchema.optional(),
  visibility: z.enum(VISIBILITIES),
  title: z.string().trim().min(1).max(TITLE_MAX_LENGTH),
  description: z.string().trim().max(DESCRIPTION_MAX_LENGTH).default(""),
  prepMinutes: z.number().int().nonnegative().nullable().default(null),
  cookMinutes: z.number().int().nonnegative().nullable().default(null),
  servings: z.number().positive().nullable().default(null),
  difficulty: z.enum(["easy", "medium", "hard"]).nullable().default(null),
  category: z.string().trim().max(60).nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(40)).max(MAX_TAGS).default([]),
  sourceUrl: httpUrlSchema.nullable().default(null),
  bookTitle: z.string().trim().max(BOOK_TITLE_MAX_LENGTH).nullable().default(null),
  bookAuthor: z.string().trim().max(BOOK_AUTHOR_MAX_LENGTH).nullable().default(null),
  bookPage: z.number().int().positive().max(BOOK_PAGE_MAX).nullable().default(null),
  ingredients: z
    .array(
      z.object({
        quantity: z.number().nonnegative().nullable().default(null),
        unit: z.string().trim().max(30).nullable().default(null),
        name: z.string().trim().min(1).max(200),
        note: z.string().trim().max(200).nullable().default(null),
      }),
    )
    .max(MAX_INGREDIENTS)
    .default([]),
  steps: z.array(z.string().trim().min(1).max(2000)).max(MAX_STEPS).default([]),
  notesMarkdown: z.string().max(20_000).default(""),
  /** Staged media ids (from tmp/staged-media) to attach atomically on create. */
  stagedMedia: z.array(uuidSchema).optional().default([]),
});

/* --------------------------------- meal plan --------------------------------- */

export const mealPlanEntrySchema = z.object({
  id: uuidSchema,
  day: z.number().int().min(0).max(6),
  slot: z.enum(MEAL_SLOTS),
  recipeId: uuidSchema,
  note: z.string().trim().max(200).nullable(),
});

export const mealPlanSchema = z.object({
  schemaVersion: z.literal(1),
  id: uuidSchema,
  accountId: uuidSchema,
  weekId: weekIdSchema,
  entries: z.array(mealPlanEntrySchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

/* ------------------------------- shopping list ------------------------------- */

export const shoppingListItemSchema = z.object({
  id: uuidSchema,
  text: z.string().trim().min(1).max(200),
  quantity: z.number().nonnegative().nullable(),
  unit: z.string().trim().max(30).nullable(),
  checked: z.boolean(),
  source: z.enum(["generated", "manual"]),
  /** Attribution for generated items; preserved as a snapshot even if the recipe changes. */
  recipeId: uuidSchema.nullable(),
  recipeTitle: z.string().trim().max(200).nullable(),
});

export const shoppingListSchema = z.object({
  schemaVersion: z.literal(1),
  id: uuidSchema,
  accountId: uuidSchema,
  name: z.string().trim().min(1).max(120),
  sourceMealPlanId: uuidSchema.nullable(),
  items: z.array(shoppingListItemSchema).max(MAX_LIST_ITEMS),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

/* -------------------------------- site config -------------------------------- */

export const siteConfigSchema = z.object({
  schemaVersion: z.literal(1),
  siteName: z.string().trim().min(1).max(80),
  defaultVisibility: z.enum(SITE_DEFAULT_VISIBILITIES),
  theme: z.enum(THEMES),
  setupCompletedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const siteConfigPatchSchema = siteConfigSchema.pick({
  siteName: true,
  defaultVisibility: true,
  theme: true,
});

/* -------------------------------- search index ------------------------------- */

export const searchIndexEntrySchema = z.object({
  id: uuidSchema,
  slug: slugSchema,
  title: z.string(),
  description: z.string(),
  category: z.string().nullable(),
  tags: z.array(z.string()),
  visibility: z.enum(VISIBILITIES),
  archived: z.boolean(),
  primaryMediaId: uuidSchema.nullable(),
  prepMinutes: z.number().int().nonnegative().nullable(),
  cookMinutes: z.number().int().nonnegative().nullable(),
  totalMinutes: z.number().int().nonnegative().nullable(),
  difficulty: z.enum(["easy", "medium", "hard"]).nullable(),
});

export const searchIndexSchema = z.object({
  schemaVersion: z.literal(1),
  builtAt: isoDateTimeSchema,
  /** slug (current and aliases) → recipe id, for cheap route resolution. */
  slugToId: z.record(z.string(), uuidSchema),
  entries: z.array(searchIndexEntrySchema),
});

/* --------------------------------- audit log --------------------------------- */

export const AUDIT_EVENT_TYPES = [
  "setup.completed",
  "auth.login.success",
  "auth.login.failure",
  "auth.login.throttled",
  "auth.password.changed",
  "account.created",
  "account.disabled",
  "account.enabled",
  "account.capabilities.changed",
  "invitation.created",
  "invitation.accepted",
  "invitation.cancelled",
  "recipe.created",
  "recipe.updated",
  "recipe.archived",
  "recipe.restored",
  "media.uploaded",
  "media.deleted",
  "import.performed",
  "backup.created",
  "backup.restored",
  "backup.restore.failed",
  "backup.restore.recovered",
  "migration.applied",
  "settings.updated",
] as const;

export const auditEventSchema = z.object({
  at: isoDateTimeSchema,
  type: z.enum(AUDIT_EVENT_TYPES),
  actorAccountId: uuidSchema.nullable(),
  /** Client address (not a secret); never contains credentials or tokens. */
  clientAddress: z.string().nullable(),
  detail: z.record(z.string(), z.unknown()).default({}),
});
