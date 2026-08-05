/**
 * Shared domain types. Every persisted shape has a matching Zod schema in
 * src/lib/validation/schemas.ts — schemas are the source of truth and these
 * types are inferred from them so the two can never drift.
 */
import type { z } from "zod";
import type {
  accountSchema,
  invitationSchema,
  recipeSchema,
  mealPlanSchema,
  shoppingListSchema,
  siteConfigSchema,
  recipeDraftSchema,
  searchIndexSchema,
  auditEventSchema,
} from "@/lib/validation/schemas";

export type Account = z.infer<typeof accountSchema>;
export type Invitation = z.infer<typeof invitationSchema>;
export type Recipe = z.infer<typeof recipeSchema>;
export type MealPlan = z.infer<typeof mealPlanSchema>;
export type ShoppingList = z.infer<typeof shoppingListSchema>;
export type SiteConfig = z.infer<typeof siteConfigSchema>;
export type RecipeDraft = z.infer<typeof recipeDraftSchema>;
export type SearchIndex = z.infer<typeof searchIndexSchema>;
export type SearchIndexEntry = SearchIndex["entries"][number];
export type AuditEvent = z.infer<typeof auditEventSchema>;

export type AccountType = Account["type"];
export type Visibility = Recipe["visibility"];
export type ResolvedVisibility = Exclude<Visibility, "inherit">;
export type Ingredient = Recipe["ingredients"][number];
export type RecipeStep = Recipe["steps"][number];
export type MediaItem = Recipe["media"][number];
export type MealSlot = MealPlan["entries"][number]["slot"];

/**
 * A processed image held in tmp/staged-media until it is attached to a recipe
 * at creation time. Mirrors MediaItem but omits ownerAccountId, which lives
 * only in the sidecar JSON on disk.
 */
export interface StagedMediaItem {
  id: string;
  fileName: string;
  alt: string;
  width: number;
  height: number;
  bytes: number;
  isPrimary: boolean;
  createdAt: string;
}

/** The authenticated principal for the current request (never trusted from the JWT alone). */
export interface SessionPrincipal {
  accountId: string;
  sessionVersion: number;
}

/** A recipe summary safe to render in lists after an authorization check. */
export interface RecipeSummary {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string | null;
  tags: string[];
  primaryMediaId: string | null;
  archived: boolean;
}
