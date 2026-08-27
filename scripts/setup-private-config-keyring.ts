#!/usr/bin/env tsx
/**
 * Safe, automatic setup / rotation CLI for PRIVATE_CONFIG_KEYRING.
 *
 * Generates a cryptographically random 32-byte base64url key and writes
 * `PRIVATE_CONFIG_KEYRING=<keyId>:<key>` into a chosen environment file.
 *
 * NOTE: The target path flag is `--env-target`, NOT `--env-file`.
 *       Node.js v20.6+ reserves `--env-file` as a built-in flag; using it
 *       causes Node to intercept the option before this script can parse it.
 *
 * Usage:
 *   npm run cli:setup-private-config-keyring -- --env-target .env
 *   npm run cli:setup-private-config-keyring -- --env-target .env --key-id backup
 *   npm run cli:setup-private-config-keyring -- --env-target .env --rotate
 *   npm run cli:setup-private-config-keyring -- --env-target .env --print
 */

import { randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "./lib";

/* -------------------------------------------------------------------------- */
/*  Pure helpers (exported for testability)                                    */
/* -------------------------------------------------------------------------- */

const KEY_BYTES = 32;
const ENV_VAR = "PRIVATE_CONFIG_KEYRING";

/** Generate a cryptographically random keyId:base64url(32-byte-key) pair. */
export function generateKeyPair(keyId: string): string {
  const key = randomBytes(KEY_BYTES).toString("base64url");
  return `${keyId}:${key}`;
}

/** Validate a keyring ID: must be non-empty, alphanumeric + hyphens/underscores. */
export function isValidKeyId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id);
}

/**
 * Parse the value of PRIVATE_CONFIG_KEYRING into individual comma-separated
 * entries, preserving the original ordering and any whitespace.
 */
export function parseKeyringEntries(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw.split(",").map((e) => e.trim()).filter(Boolean);
}

/**
 * Parse an env file into an ordered array of lines.
 * Each element is `{ key, value, line }` where `line` is the original raw text.
 * Lines that don't match `KEY=VALUE` are returned with key=null.
 */
export interface EnvLine {
  key: string | null;
  value: string | null;
  line: string;
}

export function parseEnvFile(content: string): EnvLine[] {
  // Split on newlines, but drop a trailing empty element caused by a
  // trailing newline (e.g. "A=1\n".split("\n") → ["A=1", ""]).
  const rawParts = content.split("\n");
  const lines: EnvLine[] = [];
  for (let i = 0; i < rawParts.length; i++) {
    const raw = rawParts[i]!;
    // Skip the phantom trailing empty string after the last newline.
    if (i === rawParts.length - 1 && raw === "") continue;
    const trimmed = raw.trimStart();
    if (!trimmed || trimmed.startsWith("#")) {
      lines.push({ key: null, value: null, line: raw });
      continue;
    }
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) {
      lines.push({ key: null, value: null, line: raw });
      continue;
    }
    const key = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    lines.push({ key, value, line: raw });
  }
  return lines;
}

/**
 * Validate that the parsed lines contain at most one PRIVATE_CONFIG_KEYRING
 * assignment.  Duplicate assignments are a common copy-paste mistake and make
 * the effective value ambiguous; fail closed.
 */
export function assertNoDuplicateKeyringLines(lines: EnvLine[]): void {
  const dupes = lines.filter((l) => l.key === ENV_VAR);
  if (dupes.length > 1) {
    throw new Error(
      `Found ${dupes.length} PRIVATE_CONFIG_KEYRING assignments in the target file.\n` +
        "Remove duplicates so there is exactly one line, then retry.",
    );
  }
}

/**
 * Reconstruct an env file from parsed lines.
 * Inserts a new key=value before the first existing PRIVATE_CONFIG_KEYRING line
 * (which is then removed), or appends at the end if no existing line.
 * Returns the full file content as a single string.
 *
 * When replaceExisting is true ALL duplicate PRIVATE_CONFIG_KEYRING lines are
 * removed (deterministic), but the caller should first call
 * assertNoDuplicateKeyringLines when not replacing to surface the ambiguity.
 */
export function rebuildEnvFile(
  lines: EnvLine[],
  newAssignment: string,
  replaceExisting: boolean,
): string {
  const output: string[] = [];
  let replaced = false;
  let inserted = false;

  for (const entry of lines) {
    if (entry.key === ENV_VAR && replaceExisting) {
      if (!replaced) {
        // Replace this line with the new assignment.
        output.push(newAssignment);
        replaced = true;
      }
      // Skip all subsequent duplicate PRIVATE_CONFIG_KEYRING lines.
      continue;
    }
    output.push(entry.line);

    // For initial (non-replace) inserts: place the new assignment after any
    // leading comments/blank lines but before the first variable.
    // When replaceExisting is true the keyring line itself will be swapped
    // later in the loop, so we must not also pre-insert here.
    if (!replaceExisting && !replaced && !inserted && entry.key !== null) {
      // We just pushed a variable line — insert before it.
      output.splice(output.length - 1, 0, newAssignment);
      inserted = true;
    }
  }

  if (!replaced && !inserted) {
    // File has no variable lines at all — just comments/blanks. Append at end.
    output.push(newAssignment);
  }

  // Ensure file ends with exactly one newline.
  const text = output.join("\n");
  if (text.length > 0 && !text.endsWith("\n")) {
    return text + "\n";
  }
  return text;
}

/**
 * Validate that the target file is not a symlink.
 * Throws with a clear message if it is.
 */
export async function assertNotSymlink(filePath: string): Promise<void> {
  try {
    const info = await lstat(filePath);
    if (info.isSymbolicLink()) {
      throw new Error(
        `Refusing to overwrite symlink target: ${filePath}\n` +
          "Use the real file path instead of a symlink.",
      );
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return; // File doesn't exist yet — fine.
    }
    throw err;
  }
}

/**
 * Ensure the parent directory exists (but do NOT create it).
 * Throws if the parent directory does not exist.
 */
export async function assertParentExists(filePath: string): Promise<void> {
  const parent = dirname(resolve(filePath));
  try {
    await stat(parent);
  } catch {
    throw new Error(
      `Parent directory does not exist: ${parent}\n` +
        "Create it first or point --env-target at an existing directory.",
    );
  }
}

/**
 * Set file mode to 0600 on POSIX systems. No-op on Windows.
 */
export async function setSecretFileMode(filePath: string): Promise<void> {
  if (process.platform === "win32") return;
  await chmod(filePath, 0o600);
}

/** Result returned by the setup function (testable without side effects). */
export interface SetupResult {
  envFile: string;
  keyId: string;
  mode: "initial" | "rotate";
  /** Only populated when --print is used. */
  assignment?: string;
}

/**
 * Core logic: set up or rotate the PRIVATE_CONFIG_KEYRING variable in a target
 * env file. Returns the result without printing secrets.
 *
 * `existingContent` may be `null` for a file that doesn't exist yet.
 */
export function setupKeyring(opts: {
  existingContent: string | null;
  keyId: string;
  rotate: boolean;
}): { assignment: string; result: SetupResult } {
  const { keyId, rotate } = opts;

  if (!isValidKeyId(keyId)) {
    throw new Error(
      `Invalid key ID: "${keyId}". Key IDs must contain only alphanumeric characters, hyphens, and underscores.`,
    );
  }

  const newPair = generateKeyPair(keyId);

  if (!opts.existingContent || opts.existingContent.trim() === "") {
    // Fresh file.
    const assignment = `${ENV_VAR}=${newPair}`;
    return {
      assignment,
      result: {
        envFile: "", // caller fills in
        keyId,
        mode: "initial",
      },
    };
  }

  // File has content — parse it.
  const lines = parseEnvFile(opts.existingContent);
  const existingLine = lines.find((l) => l.key === ENV_VAR);

  if (!existingLine) {
    // Variable not present — initial setup within an existing file.
    const assignment = `${ENV_VAR}=${newPair}`;
    return {
      assignment,
      result: {
        envFile: "", // caller fills in
        keyId,
        mode: "initial",
      },
    };
  }

  // Variable already exists.
  if (!rotate) {
    throw new Error(
      `${ENV_VAR} already exists in the target file.\n` +
        "Use --rotate to rotate the keyring (prepend a new key, keep old keys for decryption).",
    );
  }

  // Rotation: prepend new entry, keep existing entries.
  const existingValue = existingLine.value ?? "";
  const existingEntries = parseKeyringEntries(existingValue);
  const tail = existingEntries.length > 0 ? `,${existingEntries.join(",")}` : "";
  const newFullAssignment = `${ENV_VAR}=${newPair}${tail}`;

  return {
    assignment: newFullAssignment,
    result: {
      envFile: "", // caller fills in
      keyId,
      mode: "rotate",
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  CLI entry point                                                           */
/* -------------------------------------------------------------------------- */

async function main() {
  const { flags, booleans } = parseArgs(process.argv.slice(2));

  // Validate boolean flags.
  const rotate = booleans.has("rotate");
  const print = booleans.has("print") || booleans.has("stdout");

  // --env-target is required (NOT --env-file, which Node.js v20.6+ reserves).
  const envFileRaw = flags["env-target"];
  if (!envFileRaw) {
    console.error("Error: --env-target <path> is required.");
    console.error("Example: npm run cli:setup-private-config-keyring -- --env-target .env");
    process.exit(2);
  }
  const envFile = resolve(envFileRaw);

  // --key-id validation.
  const keyId = flags["key-id"] ?? "main";
  if (!isValidKeyId(keyId)) {
    console.error(
      `Error: Invalid key ID "${keyId}". Key IDs must contain only alphanumeric characters, hyphens, and underscores.`,
    );
    process.exit(2);
  }

  // Safety checks.
  try {
    await assertNotSymlink(envFile);
    await assertParentExists(envFile);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }

  // Read existing content (if file exists).
  let existingContent: string | null = null;
  try {
    existingContent = await readFile(envFile, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`Error reading ${envFile}: ${(err as Error).message}`);
      process.exit(1);
    }
    // File doesn't exist — that's fine.
  }

  // Run the core setup logic.
  let assignment: string;
  let result: SetupResult;
  try {
    // Reject duplicate PRIVATE_CONFIG_KEYRING assignments when not rotating.
    if (existingContent && !rotate) {
      assertNoDuplicateKeyringLines(parseEnvFile(existingContent));
    }
    const out = setupKeyring({ existingContent, keyId, rotate });
    assignment = out.assignment;
    result = out.result;
    result.envFile = envFile;
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }

  // Write the file.
  const newContent =
    existingContent === null || existingContent.trim() === ""
      ? assignment + "\n"
      : rebuildEnvFile(parseEnvFile(existingContent), assignment, result.mode === "rotate");

  try {
    await writeFile(envFile, newContent, "utf8");
    await setSecretFileMode(envFile);
  } catch (err) {
    console.error(`Error writing ${envFile}: ${(err as Error).message}`);
    process.exit(1);
  }

  // Report success — never print the key by default.
  console.log(
    `PRIVATE_CONFIG_KEYRING ${result.mode === "rotate" ? "rotated" : "created"} successfully.`,
  );
  console.log(`  File:   ${envFile}`);
  console.log(`  Key ID: ${result.keyId}`);
  if (result.mode === "rotate") {
    console.log("  Previous keys retained for decrypting existing data.");
  }
  console.log(
    "  Back up this file securely — losing the keyring means losing access to encrypted data.",
  );

  if (print) {
    console.log(`\n${assignment}`);
  }
}

// Only run the CLI entry point when executed directly (not when imported for testing).
const isMainModule =
  process.argv[1] &&
  (process.argv[1]!.endsWith("/setup-private-config-keyring.ts") ||
    process.argv[1]!.endsWith("\\setup-private-config-keyring.ts"));

if (isMainModule) {
  main();
}
