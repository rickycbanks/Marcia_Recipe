import { copyFile, mkdir, readFile, rename, rm } from "node:fs/promises";
import type { Account, MediaItem, Recipe, StagedMediaItem } from "@/types";
import { audit } from "@/lib/audit/log";
import { forbidden, notFound } from "@/lib/errors";
import { assertUuid, newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { canViewRecipe } from "@/lib/authorization/visibility";
import { rebuildSearchIndex, rebuildSuggestionIndex } from "@/lib/storage/indexes";
import { withWriteLock } from "@/lib/storage/lock";
import { recipeMediaDir, getRecipe, saveRecipe } from "@/lib/storage/repositories/recipes";
import { getSiteConfig } from "@/lib/storage/repositories/config";
import { resolveWithin } from "@/lib/storage/paths";
import { processImageUpload } from "./images";
import { readJson, writeBufferAtomic, writeJsonAtomic } from "@/lib/storage/atomic";
import { stagedMediaItemSchema } from "@/lib/validation/schemas";
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
    await rebuildSuggestionIndex();
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
    await rebuildSuggestionIndex();
    await audit({
      type: "media.deleted",
      actorAccountId: account.id,
      clientAddress: null,
      detail: { recipeId: recipe.id, mediaId },
    });
  });
}

/* ------------------------------ staged uploads ------------------------------ */

/** Scratch location for uploads awaiting recipe creation. */
const stagedMediaDir = () => resolveWithin("tmp", "staged-media");

/**
 * Owner-only staged upload: process to WebP and hold in tmp/staged-media with a
 * sidecar metadata JSON until the recipe is created. Scratch data — no write
 * lock required; both file writes are atomic.
 */
export async function stageMediaUpload(account: Account, upload: Buffer, alt: string): Promise<StagedMediaItem> {
  ensureOwner(account);
  const processed = await processImageUpload(upload);
  const mediaId = newId();
  await mkdir(stagedMediaDir(), { recursive: true });
  await writeBufferAtomic(resolveWithin("tmp", "staged-media", `${mediaId}.webp`), processed.buffer);
  const item: StagedMediaItem = {
    id: mediaId,
    fileName: `${mediaId}.webp`,
    alt: alt.trim().slice(0, 200),
    width: processed.width,
    height: processed.height,
    bytes: processed.bytes,
    isPrimary: false,
    createdAt: nowIso(),
  };
  await writeJsonAtomic(resolveWithin("tmp", "staged-media", `${mediaId}.json`), {
    ...item,
    ownerAccountId: account.id,
  });
  await audit({
    type: "media.uploaded",
    actorAccountId: account.id,
    clientAddress: null,
    detail: { staged: true, mediaId },
  });
  return item;
}

/** Owner-only discard of a staged upload. Idempotent — a missing sidecar means it's already gone. */
export async function removeStagedMedia(account: Account, mediaId: string): Promise<void> {
  ensureOwner(account);
  const id = assertUuid(mediaId);
  const sidecarPath = resolveWithin("tmp", "staged-media", `${id}.json`);
  const sidecar = await readJson(sidecarPath, stagedMediaItemSchema).catch((error) => {
    // Malformed/unreadable sidecar: treat as already discarded, clean up best-effort.
    logger.warn("Staged media sidecar unreadable; discarding best-effort", { mediaId: id, error: String(error) });
    return null;
  });
  if (sidecar === null) return;
  // Belt-and-suspenders: staged files are attributed to the uploading account.
  if (sidecar.ownerAccountId !== account.id) throw forbidden("Staged media does not belong to this account");
  await rm(resolveWithin("tmp", "staged-media", `${id}.webp`), { force: true }).catch(() => undefined);
  await rm(sidecarPath, { force: true }).catch(() => undefined);
}

/**
 * Move staged media into a recipe's media directory, building the MediaItem
 * list in order (first attached item becomes primary). Runs under the caller's
 * write lock (createRecipe). Missing/already-cleaned staged items are skipped
 * and never abort recipe creation.
 */
export async function attachStagedMediaToRecipe(
  recipeId: string,
  stagedMediaIds: string[],
  ownerIsPrimaryFallback: boolean,
): Promise<MediaItem[]> {
  assertUuid(recipeId, "recipe id");
  const media: MediaItem[] = [];
  for (const rawId of stagedMediaIds) {
    const mediaId = assertUuid(rawId, "staged media id");
    const sidecarPath = resolveWithin("tmp", "staged-media", `${mediaId}.json`);
    const sidecar = await readJson(sidecarPath, stagedMediaItemSchema);
    if (sidecar === null) {
      logger.warn("Staged media already cleaned; skipping attach", { mediaId });
      continue;
    }
    const srcWebp = resolveWithin("tmp", "staged-media", `${mediaId}.webp`);
    const dstWebp = resolveWithin("recipes", recipeId, "media", `${mediaId}.webp`);
    await mkdir(recipeMediaDir(recipeId), { recursive: true });
    try {
      await rename(srcWebp, dstWebp);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EXDEV") {
        await copyFile(srcWebp, dstWebp);
        await rm(srcWebp, { force: true });
      } else {
        logger.warn("Failed to move staged media into recipe; skipping attach", { mediaId, error: String(err) });
        continue;
      }
    }
    media.push({
      id: mediaId,
      fileName: `${mediaId}.webp`,
      alt: sidecar.alt,
      width: sidecar.width,
      height: sidecar.height,
      bytes: sidecar.bytes,
      isPrimary: media.length === 0,
      createdAt: sidecar.createdAt,
    });
    await rm(sidecarPath, { force: true }).catch(() => undefined);
  }
  if (ownerIsPrimaryFallback && media.length > 0 && !media[0]!.isPrimary) {
    media[0] = { ...media[0]!, isPrimary: true };
  }
  return media;
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
