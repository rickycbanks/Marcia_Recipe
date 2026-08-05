import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, type Dirent } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import * as tar from "tar-stream";
import type { Account, Invitation, MealPlan, Recipe, ShoppingList } from "@/types";
import { audit } from "@/lib/audit/log";
import { createBackupWhileLocked, type BackupInfo } from "@/lib/backups/service";
import { AppError, badRequest } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { migrateDocument } from "@/lib/storage/migrations";
import {
  DATA_DIRS,
  clearDataRootSwapMarker,
  getDataRoot,
  getRollbackRoot,
  readDataRootSwapMarker,
  recoverDataRoot,
  validateDataRootSwapPrerequisites,
  writeDataRootSwapMarker,
  type DataRootSwapMarker,
} from "@/lib/storage/dataRoot";
import { withLock, withWriteLock } from "@/lib/storage/lock";
import { buildSearchIndex, writeSearchIndexAt } from "@/lib/storage/indexes";
import { writeJsonAtomic } from "@/lib/storage/atomic";
import { SCHEMA_VERSIONS } from "@/lib/validation/constants";
import {
  accountSchema,
  invitationSchema,
  mealPlanSchema,
  recipeSchema,
  searchIndexSchema,
  shoppingListSchema,
  siteConfigSchema,
  weekIdSchema,
} from "@/lib/validation/schemas";

/** Decompression limits are independent of the compressed upload size. */
const MAX_ARCHIVE_ENTRIES = 50_000;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_DECOMPRESSED_BYTES = 512 * 1024 * 1024;

const UUID_PATH = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const MEDIA_ENTRY_RE = new RegExp(`^recipes/${UUID_PATH}/media/${UUID_PATH}\\.webp$`);

interface RestoreManifest {
  formatVersion: number;
  createdAt: string;
  fileCount: number;
}

interface ExtractedArchive {
  root: string;
  names: Set<string>;
  mediaFiles: number;
}

export interface RestoreReport {
  manifest: RestoreManifest;
  entries: number;
  jsonDocumentsValidated: number;
  mediaFiles: number;
  dryRun: boolean;
  restored: boolean;
  problems: string[];
  safetyBackup?: BackupInfo;
}

export type RestoreSwapFailpoint =
  | "before-root-to-rollback"
  | "after-root-to-rollback"
  | "before-stage-to-root"
  | "after-stage-to-root";

export type RestoreActorCallback = () => Account | null | Promise<Account | null>;

export interface RestoreOptions {
  dryRun?: boolean;
  force?: boolean;
  /** Runs only after both stable backup/write locks have been acquired. */
  beforeCommit?: RestoreActorCallback;
  /** A fixed actor, or a deferred actor lookup for the eventual commit. */
  actor?: Account | null | RestoreActorCallback;
  /** Request origin supplied by the route; null for non-HTTP callers. */
  clientAddress?: string | null;
  /** Test/operational seam around each root-swap rename boundary. */
  failpoint?: (point: RestoreSwapFailpoint) => void | Promise<void>;
}

class EntryBudget extends Transform {
  private bytes = 0;

  constructor(
    private readonly onBytes: (bytes: number) => void,
    private readonly maxBytes: number,
  ) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.bytes += chunk.byteLength;
    try {
      if (this.bytes > this.maxBytes) {
        callback(new AppError("PAYLOAD_TOO_LARGE", "A backup member exceeds the restore entry size cap"));
        return;
      }
      this.onBytes(chunk.byteLength);
      callback(null, chunk);
    } catch (err) {
      callback(err as Error);
    }
  }
}

class DecompressedTarBudget extends Transform {
  private bytes = 0;

  constructor(private readonly maxBytes: number) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.bytes += chunk.byteLength;
    if (this.bytes > this.maxBytes) {
      callback(new AppError("PAYLOAD_TOO_LARGE", "Archive exceeds the restore decompressed size cap"));
      return;
    }
    callback(null, chunk);
  }
}

/** Archive paths are checked before they ever become filesystem paths. */
function isCanonicalMemberName(name: string): boolean {
  if (
    name.length === 0 ||
    name !== name.normalize("NFC") ||
    name.startsWith("/") ||
    name.endsWith("/") ||
    name.includes("\\") ||
    name.includes("\0") ||
    !/^[A-Za-z0-9._/-]+$/.test(name)
  ) {
    return false;
  }
  const parts = name.split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

const FILESYSTEM_ERROR_CODES = new Set([
  "EACCES",
  "EBUSY",
  "EEXIST",
  "EIO",
  "EISDIR",
  "ELOOP",
  "EMFILE",
  "ENFILE",
  "ENOENT",
  "ENOSPC",
  "ENOTDIR",
  "ENOTEMPTY",
  "EPERM",
  "EROFS",
  "EXDEV",
]);

function isFilesystemError(err: unknown): boolean {
  return typeof err === "object" && err !== null && FILESYSTEM_ERROR_CODES.has(String((err as NodeJS.ErrnoException).code));
}

function filesystemError(err: unknown): AppError {
  return new AppError("INTERNAL", "Restore could not access its staging filesystem", err);
}

function archiveError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (isFilesystemError(err)) return filesystemError(err);
  return badRequest("Backup archive is not a valid gzip/tar archive");
}

/**
 * Stream a gzip/tar archive directly into a sibling staging root. No complete
 * tar member is retained in memory; only the bounded extraction counters are.
 */
async function extractArchive(archivePath: string): Promise<ExtractedArchive> {
  const liveRoot = getDataRoot();
  await mkdir(dirname(liveRoot), { recursive: true });
  const root = await mkdtemp(join(dirname(liveRoot), `.marcia-restore-${process.pid}-`));
  const names = new Set<string>();
  let mediaFiles = 0;
  let entryCount = 0;

  const extract = tar.extract();
  extract.on("entry", (header, stream, next) => {
    void (async () => {
      let tempPath: string | undefined;
      try {
        if (header.type !== "file") throw badRequest("Backup contains a non-file tar member");
        if (!isCanonicalMemberName(header.name)) {
          throw badRequest(`${header.name}: unsafe or non-canonical path in archive`);
        }
        if (names.has(header.name)) throw badRequest(`${header.name}: duplicate path in archive`);
        const declaredSize = header.size;
        if (typeof declaredSize !== "number" || !Number.isSafeInteger(declaredSize) || declaredSize < 0) {
          throw badRequest(`${header.name}: invalid archive member size`);
        }
        if (declaredSize > MAX_ENTRY_BYTES) {
          throw new AppError("PAYLOAD_TOO_LARGE", `${header.name}: archive member exceeds the restore size cap`);
        }
        entryCount += 1;
        if (entryCount > MAX_ARCHIVE_ENTRIES) {
          throw new AppError("PAYLOAD_TOO_LARGE", "Archive contains too many members");
        }
        names.add(header.name);
        if (MEDIA_ENTRY_RE.test(header.name)) mediaFiles += 1;

        const destination = join(root, header.name);
        await mkdir(dirname(destination), { recursive: true });
        tempPath = `${destination}.tmp-${randomUUID()}`;
        const output = createWriteStream(tempPath, { flags: "wx", mode: 0o600 });
        let streamedBytes = 0;
        await pipeline(
          stream,
          new EntryBudget((bytes) => {
            // The declared tar size is checked above; this also protects
            // against malformed streams that emit more data than declared.
            streamedBytes += bytes;
            if (streamedBytes > declaredSize) throw badRequest(`${header.name}: malformed tar member size`);
          }, MAX_ENTRY_BYTES),
          output,
        );
        if (streamedBytes !== declaredSize) {
          throw badRequest(`${header.name}: truncated tar member`);
        }
        await rename(tempPath, destination);
        tempPath = undefined;
        next();
      } catch (err) {
        if (tempPath) await rm(tempPath, { force: true }).catch(() => undefined);
        // The entry stream may be unconsumed (the declared-size cap rejects it
        // before any data is piped). Attach a no-op error handler so that when
        // tar-stream destroys the unconsumed entry stream on `next(err)` it
        // cannot emit an unhandled 'error' event.
        stream.on("error", () => undefined);
        next(archiveError(err));
      }
    })();
  });

  try {
    // Count every post-gunzip tar byte, including headers, padding and other
    // framing, not just file bodies reported by tar-stream.
    await pipeline(createReadStream(archivePath), createGunzip(), new DecompressedTarBudget(MAX_TOTAL_DECOMPRESSED_BYTES), extract);
  } catch (err) {
    await rm(root, { recursive: true, force: true });
    throw archiveError(err);
  }
  return { root, names, mediaFiles };
}

async function ensureStagingLayout(root: string): Promise<void> {
  await Promise.all(DATA_DIRS.map((directory) => mkdir(join(root, directory), { recursive: true })));
}

type RoutedDocument =
  | { kind: "siteConfig" }
  | { kind: "account"; pathId: string }
  | { kind: "invitation"; pathId: string }
  | { kind: "recipe"; pathId: string }
  | { kind: "mealPlan"; accountId: string; weekId: string }
  | { kind: "shoppingList"; accountId: string; pathId: string };

function routeDocument(name: string): RoutedDocument | null {
  if (name === "config/site.json") return { kind: "siteConfig" };
  let match = name.match(new RegExp(`^accounts/(${UUID_PATH})\\.json$`));
  if (match?.[1]) return { kind: "account", pathId: match[1] };
  match = name.match(new RegExp(`^invitations/(${UUID_PATH})\\.json$`));
  if (match?.[1]) return { kind: "invitation", pathId: match[1] };
  match = name.match(new RegExp(`^recipes/(${UUID_PATH})/recipe\\.json$`));
  if (match?.[1]) return { kind: "recipe", pathId: match[1] };
  match = name.match(new RegExp(`^users/(${UUID_PATH})/meal-plans/(\\d{4}-W(?:0[1-9]|[1-4]\\d|5[0-3]))\\.json$`));
  if (match?.[1] && match[2] && weekIdSchema.safeParse(match[2]).success) {
    return { kind: "mealPlan", accountId: match[1], weekId: match[2] };
  }
  match = name.match(new RegExp(`^users/(${UUID_PATH})/shopping-lists/(${UUID_PATH})\\.json$`));
  if (match?.[1] && match[2]) return { kind: "shoppingList", accountId: match[1], pathId: match[2] };
  return null;
}

interface ValidatedStage {
  accounts: Account[];
  recipes: Recipe[];
  jsonDocumentsValidated: number;
  problems: string[];
  migrationsApplied: number;
  index?: ReturnType<typeof buildSearchIndex>;
}

function idProblem(name: string, expected: string, actual: string): string | null {
  return expected === actual ? null : `${name}: document id ${actual} does not match canonical path id ${expected}`;
}

/** Validate the complete staged dataset and persist any migrated documents there. */
async function validateStagedRoot(stage: ExtractedArchive, manifest: RestoreManifest): Promise<ValidatedStage> {
  const problems: string[] = [];
  const accounts: Account[] = [];
  const invitations: Invitation[] = [];
  const recipes: Recipe[] = [];
  const mealPlans: MealPlan[] = [];
  const shoppingLists: ShoppingList[] = [];
  let siteConfigFound = false;
  let jsonDocumentsValidated = 1; // manifest.json
  let migrationsApplied = 0;

  if (manifest.fileCount !== stage.names.size - 1) {
    problems.push(`manifest fileCount ${manifest.fileCount} does not match ${stage.names.size - 1} archived files`);
  }

  for (const name of [...stage.names].sort()) {
    if (name === "manifest.json") continue;
    if (!name.endsWith(".json")) {
      if (!MEDIA_ENTRY_RE.test(name)) problems.push(`${name}: unsupported non-JSON backup member`);
      continue;
    }
    const route = routeDocument(name);
    if (!route) {
      problems.push(`${name}: does not match any known document location`);
      continue;
    }

    let raw: string;
    try {
      raw = await readFile(join(stage.root, name), "utf8");
    } catch (err) {
      if (isFilesystemError(err)) throw filesystemError(err);
      problems.push(`${name}: invalid JSON`);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      problems.push(`${name}: invalid JSON`);
      continue;
    }

    let document = parsed;
    let migrated = false;
    if (route.kind === "recipe" && parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      try {
        const result = migrateDocument("recipe", parsed as Record<string, unknown>);
        document = result.doc;
        migrated = result.applied.length > 0;
        if (migrated) migrationsApplied += 1;
      } catch (err) {
        problems.push(`${name}: ${(err as Error).message}`);
        continue;
      }
    }

    const checked = (() => {
      switch (route.kind) {
        case "siteConfig":
          return siteConfigSchema.safeParse(document);
        case "account":
          return accountSchema.safeParse(document);
        case "invitation":
          return invitationSchema.safeParse(document);
        case "recipe":
          return recipeSchema.safeParse(document);
        case "mealPlan":
          return mealPlanSchema.safeParse(document);
        case "shoppingList":
          return shoppingListSchema.safeParse(document);
      }
    })();
    if (!checked.success) {
      const issue = checked.error.issues[0];
      problems.push(`${name}: ${issue?.path.join(".") ?? "document"} ${issue?.message ?? "schema validation failed"}`);
      continue;
    }
    jsonDocumentsValidated += 1;
    if (migrated) await writeJsonAtomic(join(stage.root, name), checked.data);

    switch (route.kind) {
      case "siteConfig":
        if (siteConfigFound) problems.push(`${name}: duplicate site config`);
        siteConfigFound = true;
        break;
      case "account": {
        const value = checked.data as Account;
        const problem = idProblem(name, route.pathId, value.id);
        if (problem) problems.push(problem);
        accounts.push(value);
        break;
      }
      case "invitation": {
        const value = checked.data as Invitation;
        const problem = idProblem(name, route.pathId, value.id);
        if (problem) problems.push(problem);
        invitations.push(value);
        break;
      }
      case "recipe": {
        const value = checked.data as Recipe;
        const problem = idProblem(name, route.pathId, value.id);
        if (problem) problems.push(problem);
        recipes.push(value);
        break;
      }
      case "mealPlan": {
        const value = checked.data as MealPlan;
        if (value.weekId !== route.weekId) {
          problems.push(`${name}: weekId does not match canonical meal-plan path`);
        }
        if (value.accountId !== route.accountId) {
          problems.push(`${name}: accountId does not match canonical user path`);
        }
        mealPlans.push(value);
        break;
      }
      case "shoppingList": {
        const value = checked.data as ShoppingList;
        const problem = idProblem(name, route.pathId, value.id);
        if (problem) problems.push(problem);
        if (value.accountId !== route.accountId) {
          problems.push(`${name}: accountId does not match canonical user path`);
        }
        shoppingLists.push(value);
        break;
      }
    }
  }

  if (!siteConfigFound) problems.push("config/site.json: required site config is missing");
  const enabledOwners = accounts.filter((account) => account.type === "owner" && account.disabledAt === null);
  if (enabledOwners.length === 0) problems.push("accounts: at least one enabled owner account is required");

  const usernames = new Set<string>();
  for (const account of accounts) {
    const username = account.username.trim().toLowerCase();
    if (usernames.has(username)) problems.push(`accounts: duplicate username ${username}`);
    usernames.add(username);
  }

  const slugs = new Set<string>();
  for (const recipe of recipes) {
    for (const slug of [recipe.slug, ...recipe.previousSlugs]) {
      if (slugs.has(slug)) problems.push(`recipes: duplicate slug ${slug}`);
      slugs.add(slug);
    }
  }

  const accountIds = new Set(accounts.map((account) => account.id));
  const recipeIds = new Set(recipes.map((recipe) => recipe.id));
  for (const invitation of invitations) {
    if (!accountIds.has(invitation.issuedBy)) problems.push(`invitations/${invitation.id}: issuer account is missing`);
    if (invitation.acceptedAccountId !== null && !accountIds.has(invitation.acceptedAccountId)) {
      problems.push(`invitations/${invitation.id}: accepted account is missing`);
    }
  }
  for (const mealPlan of mealPlans) {
    if (!accountIds.has(mealPlan.accountId)) problems.push(`meal plan ${mealPlan.id}: account is missing`);
    for (const entry of mealPlan.entries) {
      if (!recipeIds.has(entry.recipeId)) problems.push(`meal plan ${mealPlan.id}: recipe ${entry.recipeId} is missing`);
    }
  }
  for (const list of shoppingLists) {
    if (!accountIds.has(list.accountId)) problems.push(`shopping list ${list.id}: account is missing`);
  }

  const expectedMedia = new Set<string>();
  for (const recipe of recipes) {
    for (const media of recipe.media) {
      if (media.fileName !== `${media.id}.webp`) {
        problems.push(`recipes/${recipe.id}/recipe.json: media file name does not match metadata id ${media.id}`);
      }
      const mediaName = `recipes/${recipe.id}/media/${media.fileName}`;
      expectedMedia.add(mediaName);
      if (!stage.names.has(mediaName)) problems.push(`${mediaName}: media file is missing from archive`);
    }
  }
  for (const name of stage.names) {
    if (MEDIA_ENTRY_RE.test(name) && !expectedMedia.has(name)) {
      problems.push(`${name}: media file has no recipe metadata`);
    }
  }

  const result: ValidatedStage = { accounts, recipes, jsonDocumentsValidated, problems, migrationsApplied };
  if (problems.length === 0) result.index = await writeSearchIndexAt(stage.root, recipes);
  return result;
}

async function readManifest(stage: ExtractedArchive): Promise<RestoreManifest> {
  if (!stage.names.has("manifest.json")) {
    throw badRequest("Archive has no manifest.json — not a Marcia Recipe backup");
  }
  let raw: string;
  try {
    raw = await readFile(join(stage.root, "manifest.json"), "utf8");
  } catch (err) {
    if (isFilesystemError(err)) throw filesystemError(err);
    throw badRequest("Backup manifest is malformed");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw badRequest("Backup manifest is malformed");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw badRequest("Backup manifest is malformed");
  }
  const value = parsed as Record<string, unknown>;
  if (
    !Number.isInteger(value.formatVersion) ||
    (value.formatVersion as number) < 1 ||
    typeof value.createdAt !== "string" ||
    !Number.isInteger(value.fileCount) ||
    (value.fileCount as number) < 0
  ) {
    throw badRequest("Backup manifest is malformed");
  }
  if ((value.formatVersion as number) > SCHEMA_VERSIONS.backupManifest) {
    throw badRequest(`Backup format version ${value.formatVersion} is newer than this build supports`);
  }
  return {
    formatVersion: value.formatVersion as number,
    createdAt: value.createdAt as string,
    fileCount: value.fileCount as number,
  };
}

async function copyTree(source: string, destination: string): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(source, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  await mkdir(destination, { recursive: true });
  for (const entry of entries) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) await copyTree(from, to);
    else if (entry.isFile()) await copyFile(from, to);
  }
}

async function hasCanonicalData(root: string): Promise<boolean> {
  for (const directory of ["config", "accounts", "invitations", "recipes", "users"]) {
    try {
      if ((await readdir(join(root, directory))).length > 0) return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  return false;
}

async function rotateStagedSessions(stageRoot: string, currentRoot: string, accounts: Account[]): Promise<void> {
  const currentVersions = new Map<string, number>();
  let entries: Dirent[] = [];
  try {
    entries = await readdir(join(currentRoot, "accounts"), { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const value = JSON.parse(await readFile(join(currentRoot, "accounts", entry.name), "utf8"));
      const parsed = accountSchema.parse(value);
      currentVersions.set(parsed.id, parsed.sessionVersion);
    } catch {
      // A malformed live account is not a valid counterpart; staged data is
      // still rotated against its own version below.
    }
  }
  for (const account of accounts) {
    const previous = currentVersions.get(account.id) ?? -1;
    const rotated = { ...account, sessionVersion: Math.max(previous, account.sessionVersion) + 1 };
    await writeJsonAtomic(join(stageRoot, "accounts", `${account.id}.json`), accountSchema.parse(rotated));
  }
}

async function verifyActivatedRoot(root: string, index: ReturnType<typeof buildSearchIndex>): Promise<void> {
  const site = siteConfigSchema.parse(JSON.parse(await readFile(join(root, "config", "site.json"), "utf8")));
  if (!site) throw new Error("activated site config is unavailable");
  const accountEntries = await readdir(join(root, "accounts"), { withFileTypes: true });
  let enabledOwner = false;
  for (const entry of accountEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const account = accountSchema.parse(JSON.parse(await readFile(join(root, "accounts", entry.name), "utf8")));
    if (account.type === "owner" && account.disabledAt === null) enabledOwner = true;
  }
  if (!enabledOwner) throw new Error("activated root has no enabled owner");
  const actualIndex = searchIndexSchema.parse(JSON.parse(await readFile(join(root, "indexes", "search.json"), "utf8")));
  if (actualIndex.entries.length !== index.entries.length) throw new Error("activated search index is incomplete");
}

async function resolveRestoreActor(source: Account | null | RestoreActorCallback | undefined): Promise<Account | null> {
  if (typeof source === "function") return source();
  return source ?? null;
}

async function activateStage(
  stageRoot: string,
  accounts: Account[],
  index: ReturnType<typeof buildSearchIndex>,
  force: boolean,
  actor: Account | null,
  clientAddress: string | null,
  failpoint?: RestoreOptions["failpoint"],
): Promise<BackupInfo> {
  const root = getDataRoot();
  await validateDataRootSwapPrerequisites(root);
  const existingMarker = await readDataRootSwapMarker(root);
  if (existingMarker) {
    await recoverDataRoot();
    const remainingMarker = await readDataRootSwapMarker(root);
    if (remainingMarker && !["rolled-back", "prepared"].includes(remainingMarker.phase)) {
      throw new AppError("CONFLICT", "Another restore activation is still in progress");
    }
  }
  if (!force && (await hasCanonicalData(root))) {
    throw badRequest("DATA_ROOT is not empty; re-run with --force to replace existing data");
  }

  // The safety snapshot is created before the old root is moved, while both
  // locks are held by the caller.
  const safetyBackup = await createBackupWhileLocked(actor);
  await copyTree(join(root, "backups"), join(stageRoot, "backups"));
  await copyTree(join(root, "audit"), join(stageRoot, "audit"));
  await rotateStagedSessions(stageRoot, root, accounts);

  const rollback = getRollbackRoot(root);
  await withLock("root-swap", async () => {
    await validateDataRootSwapPrerequisites(root);
    const marker: DataRootSwapMarker = { version: 1, root, staging: stageRoot, rollback, phase: "prepared" };
    // Do not remove an existing rollback. A path is only safe to touch when the
    // durable marker classifies it as this operation's rollback.
    try {
      await readFile(rollback);
      throw new AppError("CONFLICT", "A rollback path already exists; refusing to overwrite it");
    } catch (err) {
      if (err instanceof AppError) throw err;
      if ((err as NodeJS.ErrnoException).code !== "ENOENT" && (err as NodeJS.ErrnoException).code !== "EISDIR") throw err;
      if ((err as NodeJS.ErrnoException).code === "EISDIR") {
        throw new AppError("CONFLICT", "A rollback path already exists; refusing to overwrite it", err);
      }
    }
    // A directory or symlink is not readable as a file, so probe the path with a
    // no-op rename only when absent; rename itself is still the real boundary.
    await writeDataRootSwapMarker(marker);
    try {
      await failpoint?.("before-root-to-rollback");
      await rename(root, rollback);
      await failpoint?.("after-root-to-rollback");
      await writeDataRootSwapMarker({ ...marker, phase: "old-root-moved" });
      await failpoint?.("before-stage-to-root");
      await rename(stageRoot, root);
      await failpoint?.("after-stage-to-root");
      await writeDataRootSwapMarker({ ...marker, phase: "stage-installed" });
      await verifyActivatedRoot(root, index);
      await writeDataRootSwapMarker({ ...marker, phase: "verified" });
    } catch (err) {
      let rolledBack = false;
      try {
        await recoverDataRoot();
        rolledBack = true;
      } catch (rollbackError) {
        throw new AppError("INTERNAL", "Restore activation failed and automatic rollback did not complete", rollbackError);
      }
      await audit({
        type: "backup.restore.failed",
        actorAccountId: actor?.id ?? null,
        clientAddress,
        detail: { reason: (err as Error).message, rolledBack },
      }).catch(() => undefined);
      throw err;
    }
    await clearDataRootSwapMarker(root).catch((err) => {
      logger.warn("Could not clear restore swap marker", { error: String(err) });
    });
  });

  // From this point on the new root is verified and canonical. Cleanup and
  // audit are deliberately best effort so a committed restore cannot report a
  // failure to its caller.
  await rm(rollback, { recursive: true, force: true }).catch((err) => {
    logger.warn("Could not remove restore rollback root", { error: String(err) });
  });
  await audit({
    type: "backup.restored",
    actorAccountId: actor?.id ?? null,
    clientAddress,
    detail: { entries: index.entries.length, safetyBackup: safetyBackup.fileName },
  });
  return safetyBackup;
}

export async function restoreBackup(
  archivePath: string,
  options: RestoreOptions = {},
): Promise<RestoreReport> {
  const dryRun = options.dryRun ?? false;
  const extracted = await extractArchive(archivePath);
  let activated = false;
  try {
    await ensureStagingLayout(extracted.root);
    const manifest = await readManifest(extracted);
    const validation = await validateStagedRoot(extracted, manifest);
    const report: RestoreReport = {
      manifest,
      entries: extracted.names.size,
      jsonDocumentsValidated: validation.jsonDocumentsValidated,
      mediaFiles: extracted.mediaFiles,
      dryRun,
      restored: false,
      problems: validation.problems,
    };

    if (validation.problems.length > 0) {
      if (dryRun) return report;
      await audit({
        type: "backup.restore.failed",
        actorAccountId:
          options.actor && typeof options.actor === "object" && "id" in options.actor ? options.actor.id : null,
        clientAddress: options.clientAddress ?? null,
        detail: { reason: "validation", problems: report.problems.length },
      }).catch(() => undefined);
      throw badRequest("Backup validation failed", report);
    }
    if (dryRun) return report;

    // TS narrows the initializer to null and then to never once a closure
    // becomes the only other assignment site; the cast keeps the declared
    // `Account | null` type intact for the post-lock reads below.
    let actor: Account | null = null as Account | null;
    const safetyBackup = await withLock("backup", () =>
      withWriteLock(async () => {
        actor = await resolveRestoreActor(options.beforeCommit ?? options.actor);
        return activateStage(
          extracted.root,
          validation.accounts,
          validation.index!,
          options.force ?? false,
          actor,
          options.clientAddress ?? null,
          options.failpoint,
        );
      }),
    );
    activated = true;
    if (validation.migrationsApplied > 0) {
      await audit({
        type: "migration.applied",
        actorAccountId: actor?.id ?? null,
        clientAddress: options.clientAddress ?? null,
        detail: { migratedDocuments: validation.migrationsApplied, surface: "restore" },
      }).catch(() => undefined);
    }
    logger.info("Backup restored", { archivePath, entries: extracted.names.size });
    return { ...report, restored: true, safetyBackup };
  } finally {
    if (!activated) await rm(extracted.root, { recursive: true, force: true }).catch(() => undefined);
  }
}
