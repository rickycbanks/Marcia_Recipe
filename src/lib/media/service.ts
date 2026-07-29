import { rm, mkdir, readFile } from "node:fs/promises";
import type { Account, MediaItem, Recipe } from "@/types";
import { audit } from "@/lib/audit/log";
import { forbidden, notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { canViewRecipe } from "@/lib/authorization/visibility";
import { rebuildSearchIndex } from "@/lib/storage/indexes";
import { withWriteLock } from "@/lib/storage/lock";
import { recipeMediaDir, getRecipe, saveRecipe } from "@/lib/storage/repositories/recipes";
import { getSiteConfig } from "@/lib/storage/repositories/config";
import { resolveWithin } from "@/lib/storage/paths";
import { processImageUpload } from "./images";
import { writeBufferAtomic } from "@/lib/storage/atomic";
import { logger } from "@/lib/logger";

function ensureOwner(account: Account): void {
  if (account.type !== "owner") throw forbidden("Only the owner can manage media");
}

/** Owner-only upload: decode-validate, resize, convert to WebP, attach to recipe. */
export async function addMediaToRecipe(
  account: Account,
  recipeId: string,
  upload: Buffer,
  alt: string,
): Promise<MediaItem> {
  ensureOwner(account);
  const processed = await processImageUpload(upload);
  return withWriteLock(async () => {
    const recipe = await getRecipe(recipeId);
    if (!recipe) throw notFound("Recipe not found");
    const mediaId = newId();
    const dir = recipeMediaDir(recipe.id);
    await mkdir(dir, { recursive: true });
    const mediaPath = resolveWithin("recipes", recipe.id, "media", `${mediaId}.webp`);
    await writeBufferAtomic(mediaPath, processed.buffer);
    const item: MediaItem = {
      id: mediaId,
      fileName: `${mediaId}.webp`,
      alt: alt.trim().slice(0, 200),
      width: processed.width,
      height: processed.height,
      bytes: processed.bytes,
      isPrimary: recipe.media.length === 0,
      createdAt: nowIso(),
    };
    const updated: Recipe = { ...recipe, media: [...recipe.media, item], updatedAt: nowIso() };
    try {
      await saveRecipe(updated);
    } catch (error) {
      await rm(mediaPath, { force: true }).catch(() => undefined);
      throw error;
    }
    await rebuildSearchIndex();
    await audit({
      type: "media.uploaded",
      actorAccountId: account.id,
      clientAddress: null,
      detail: { recipeId: recipe.id, mediaId, bytes: processed.bytes },
    });
    return item;
  });
}

export async function removeMediaFromRecipe(account: Account, recipeId: string, mediaId: string): Promise<void> {
  ensureOwner(account);
  await withWriteLock(async () => {
    const recipe = await getRecipe(recipeId);
    if (!recipe) throw notFound("Recipe not found");
    const item = recipe.media.find((m) => m.id === mediaId);
    if (!item) throw notFound("Media not found");
    const remaining = recipe.media.filter((m) => m.id !== mediaId);
    if (item.isPrimary && remaining.length > 0) remaining[0] = { ...remaining[0]!, isPrimary: true };
    await saveRecipe({ ...recipe, media: remaining, updatedAt: nowIso() });
    await rm(resolveWithin("recipes", recipe.id, "media", item.fileName), { force: true }).catch((error) => {
      logger.warn("Removed media metadata but could not remove file", { recipeId, mediaId, error: String(error) });
    });
    await rebuildSearchIndex();
    await audit({
      type: "media.deleted",
      actorAccountId: account.id,
      clientAddress: null,
      detail: { recipeId: recipe.id, mediaId },
    });
  });
}

export interface AuthorizedMedia {
  absolutePath: string;
  isPublic: boolean;
  bytes: number;
}

/**
 * Authorize a media request against its recipe's visibility and resolve the
 * on-disk path from validated UUIDs — internal storage layout never leaks.
 */
export async function authorizeMediaAccess(
  account: Account | null,
  recipeId: string,
  mediaId: string,
): Promise<AuthorizedMedia | null> {
  const recipe = await getRecipe(recipeId);
  if (!recipe) return null;
  const item = recipe.media.find((m) => m.id === mediaId);
  if (!item) return null;
  const config = await getSiteConfig();
  if (!canViewRecipe(recipe, config, account)) return null;
  if (recipe.archivedAt !== null && account?.type !== "owner") return null;
  const resolved = recipe.visibility === "inherit" ? config.defaultVisibility : recipe.visibility;
  return {
    absolutePath: resolveWithin("recipes", recipe.id, "media", item.fileName),
    isPublic: resolved === "public",
    bytes: item.bytes,
  };
}

export async function readMediaFile(media: AuthorizedMedia): Promise<Buffer> {
  return readFile(media.absolutePath);
}
