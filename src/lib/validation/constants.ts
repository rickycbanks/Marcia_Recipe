/** Current schema versions for every canonical document kind. */
export const SCHEMA_VERSIONS = {
  account: 1,
  invitation: 1,
  recipe: 1,
  mealPlan: 1,
  shoppingList: 1,
  siteConfig: 1,
  searchIndex: 1,
  backupManifest: 1,
} as const;

export type SchemaKind = keyof typeof SCHEMA_VERSIONS;

/** Guest-assignable capabilities (owner capabilities are implicit and non-assignable). */
export const GUEST_CAPABILITIES = [
  "recipes.read",
  "mealPlans.use",
  "shoppingLists.use",
] as const;

/** Capabilities reserved for owner accounts; never assignable to guests. */
export const OWNER_CAPABILITIES = [
  "recipes.manage",
  "recipes.import",
  "media.manage",
  "accounts.manage",
  "site.manage",
  "backups.manage",
] as const;

export type GuestCapability = (typeof GUEST_CAPABILITIES)[number];
export type OwnerCapability = (typeof OWNER_CAPABILITIES)[number];
export type Capability = GuestCapability | OwnerCapability;

/**
 * Capability dependencies: using the key capability requires every capability
 * in the value list. Assignments are validated to remain closed under these.
 */
export const CAPABILITY_DEPENDENCIES: Partial<Record<Capability, Capability[]>> = {
  "mealPlans.use": ["recipes.read"],
  "shoppingLists.use": ["recipes.read"],
};

export const VISIBILITIES = ["inherit", "public", "members", "owner"] as const;
export const SITE_DEFAULT_VISIBILITIES = ["public", "members"] as const;
export const THEMES = ["editorial", "warm", "ocean", "minimal"] as const;
export type ThemeName = (typeof THEMES)[number];

export const MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;

/** Media limits enforced by the upload pipeline. */
export const MEDIA_LIMITS = {
  maxUploadBytes: 10 * 1024 * 1024,
  maxPixels: 25_000_000,
  maxDimension: 1600,
  webpQuality: 80,
} as const;

/** URL import limits enforced by the SSRF-safe fetcher. */
export const IMPORT_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  timeoutMs: 10_000,
  maxRedirects: 3,
} as const;

/** Login throttling: maxAttempts per window, keyed by normalized username + client address. */
export const LOGIN_RATE_LIMIT = { maxAttempts: 5, windowMs: 5 * 60 * 1000 } as const;
/** Invitation-acceptance throttling keyed by client address. */
export const INVITE_RATE_LIMIT = { maxAttempts: 10, windowMs: 5 * 60 * 1000 } as const;

export const SLUG_MAX_LENGTH = 80;
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
export const PASSWORD_MIN_LENGTH = 10;
export const DISPLAY_NAME_MAX_LENGTH = 80;
export const TITLE_MAX_LENGTH = 200;
export const DESCRIPTION_MAX_LENGTH = 2000;
export const MAX_TAGS = 20;
export const MAX_INGREDIENTS = 200;
export const MAX_STEPS = 100;
export const MAX_LIST_ITEMS = 500;
