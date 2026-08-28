/**
 * Encrypted private OCR configuration.
 *
 * Stored at `DATA_ROOT/config/ocr.private.json` — the on-disk file is an
 * encrypted envelope; plaintext is never written. The file is not part of
 * `site.json` and is never exposed via public settings or APIs.
 *
 * Supported providers: tesseract (browser-local), mistral, gemini.
 * Legacy providers (veryfi, googleDocumentAi) are read compatibly and
 * resolved to tesseract until an owner saves a new selection.
 *
 * Without PRIVATE_CONFIG_KEYRING the module reports tesseract as the effective
 * provider. When no private config exists and MISTRAL_API_KEY env is set the
 * effective provider is Mistral (legacy compat). Once a private config file
 * exists it controls selection.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { AppError, badRequest } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getDataRoot } from "@/lib/storage/dataRoot";
import { decrypt, encrypt, isKeyringAvailable } from "./ocrCrypto";

/* -------------------------------- schemas -------------------------------- */

export const OCR_PROVIDERS = ["tesseract", "mistral", "gemini"] as const;
export type OcrProvider = (typeof OCR_PROVIDERS)[number];

/** Canonical config shape — what is written on save. */
const canonicalConfigSchema = z.object({
  activeProvider: z.enum(OCR_PROVIDERS),
  mistral: z
    .object({
      apiKey: z.string().min(1),
    })
    .optional(),
  gemini: z
    .object({
      apiKey: z.string().min(1),
    })
    .optional(),
});

export type PrivateOcrConfig = z.infer<typeof canonicalConfigSchema>;

/**
 * Lenient read schema — accepts any activeProvider string and any provider
 * sub-objects so legacy configs (veryfi, googleDocumentAi) do not crash
 * deployment. The provider is resolved after parsing.
 */
const legacyReadSchema = z.object({
  activeProvider: z.string(),
  mistral: z
    .object({ apiKey: z.string().min(1) })
    .optional(),
  gemini: z
    .object({ apiKey: z.string().min(1) })
    .optional(),
  // Legacy fields — parsed but not carried forward on save
  googleDocumentAi: z.any().optional(),
  veryfi: z.any().optional(),
});

/** Sanitized shape returned by the GET API — no secrets. */
export interface SanitizedOcrConfig {
  activeProvider: OcrProvider;
  configured: Record<OcrProvider, boolean>;
  keyringAvailable: boolean;
}

/* -------------------------------- paths ---------------------------------- */

function privateConfigPath(): string {
  return `${getDataRoot()}/config/ocr.private.json`;
}

/* -------------------------- provider resolution -------------------------- */

/** Resolve a raw provider string to a canonical OcrProvider. */
function resolveProvider(raw: string): OcrProvider {
  if (raw === "mistral" || raw === "gemini" || raw === "tesseract") return raw;
  // Legacy providers (veryfi, googleDocumentAi) resolve to tesseract
  logger.info("Legacy OCR provider resolved to tesseract", { legacyProvider: raw });
  return "tesseract";
}

/* -------------------------------- read ----------------------------------- */

async function readEncryptedFile(): Promise<PrivateOcrConfig | null> {
  let raw: string;
  try {
    raw = await readFile(privateConfigPath(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  if (!isKeyringAvailable()) {
    // File exists but no keyring — return null so callers can present an
    // actionable error rather than silently losing the config.
    return null;
  }

  let plaintext: string;
  try {
    plaintext = decrypt(raw);
  } catch (err) {
    throw new Error(`OCR config file could not be decrypted: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new Error("OCR config file is malformed (not valid JSON after decryption)");
  }

  // Try canonical schema first
  const canonical = canonicalConfigSchema.safeParse(parsed);
  if (canonical.success) return canonical.data;

  // Fall back to lenient read for legacy configs
  const legacy = legacyReadSchema.safeParse(parsed);
  if (legacy.success) {
    return {
      activeProvider: resolveProvider(legacy.data.activeProvider),
      mistral: legacy.data.mistral,
      gemini: legacy.data.gemini,
    };
  }

  const issue = (canonical.success ? null : canonical.error.issues[0]) ??
    (legacy.success ? null : legacy.error.issues[0]);
  throw new Error(`OCR config schema error: ${issue?.path.join(".") ?? "document"} ${issue?.message ?? "invalid"}`);
}

/* -------------------------------- write ---------------------------------- */

async function writeEncryptedFile(config: PrivateOcrConfig): Promise<void> {
  if (!isKeyringAvailable()) {
    throw new AppError(
      "BAD_REQUEST",
      "PRIVATE_CONFIG_KEYRING is not configured. Cloud OCR credentials cannot be saved without an encryption key. " +
        "Set PRIVATE_CONFIG_KEYRING to a comma-separated list of keyId:base64url(32-byte-key) pairs.",
    );
  }

  const plaintext = JSON.stringify(config, null, 2);
  const envelope = encrypt(plaintext);

  await mkdir(dirname(privateConfigPath()), { recursive: true });
  const tmpPath = `${privateConfigPath()}.tmp-${randomUUID()}`;
  await writeFile(tmpPath, envelope, "utf8");
  await rename(tmpPath, privateConfigPath());
}

/* -------------------------------- public API ----------------------------- */

/**
 * Get the effective OCR provider. Without a private config file:
 *  - If MISTRAL_API_KEY env is set → "mistral" (legacy compat)
 *  - Otherwise → "tesseract"
 * Once a private config file exists it controls selection.
 */
export async function getEffectiveOcrProvider(): Promise<OcrProvider> {
  const config = await readEncryptedFile();
  if (config) return config.activeProvider;

  // Legacy compat: env MISTRAL_API_KEY without private config
  if (getEnv().MISTRAL_API_KEY) return "mistral";
  return "tesseract";
}

/** Read raw config — internal use. Returns null when absent. */
export async function getPrivateOcrConfig(): Promise<PrivateOcrConfig | null> {
  return readEncryptedFile();
}

/** Read raw config, returning defaults when absent. */
async function getConfigOrDefaults(): Promise<PrivateOcrConfig> {
  const existing = await readEncryptedFile();
  return (
    existing ?? {
      activeProvider: "tesseract",
    }
  );
}

/**
 * Check whether a specific provider has all required secrets configured
 * (does not check the keyring, only the stored data).
 */
function isProviderConfigured(config: PrivateOcrConfig, provider: OcrProvider): boolean {
  switch (provider) {
    case "tesseract":
      return true;
    case "mistral":
      return !!config.mistral?.apiKey;
    case "gemini":
      return !!config.gemini?.apiKey;
  }
}

/**
 * Sanitize config for the GET API: configured booleans and keyring status.
 * Never returns secrets.
 */
export async function getSanitizedOcrConfig(): Promise<SanitizedOcrConfig> {
  const config = await getConfigOrDefaults();
  const configured: Record<OcrProvider, boolean> = {
    tesseract: true,
    mistral: isProviderConfigured(config, "mistral"),
    gemini: isProviderConfigured(config, "gemini"),
  };

  return {
    activeProvider: config.activeProvider,
    configured,
    keyringAvailable: isKeyringAvailable(),
  };
}

/* -------------------------------- provider secrets (server-only) --------- */

export interface MistralSecrets {
  apiKey: string;
}

export interface GeminiSecrets {
  apiKey: string;
}

export async function getMistralSecrets(): Promise<MistralSecrets | null> {
  const config = await readEncryptedFile();
  if (config?.mistral?.apiKey) return { apiKey: config.mistral.apiKey };
  // Legacy fallback
  const envKey = getEnv().MISTRAL_API_KEY;
  if (envKey) return { apiKey: envKey };
  return null;
}

export async function getGeminiSecrets(): Promise<GeminiSecrets | null> {
  const config = await readEncryptedFile();
  if (config?.gemini?.apiKey) return { apiKey: config.gemini.apiKey };
  return null;
}

/* -------------------------------- save ----------------------------------- */

/**
 * Patch the private OCR config. Blank secret fields in the patch retain
 * existing values. A cloud provider is never activated unless its required
 * complete config is present. Legacy provider fields are discarded on save.
 */
export async function savePrivateOcrConfig(patch: {
  activeProvider?: OcrProvider;
  mistral?: { apiKey?: string } | null;
  gemini?: { apiKey?: string } | null;
}): Promise<void> {
  const existing = await getConfigOrDefaults();
  const merged: PrivateOcrConfig = {
    activeProvider: existing.activeProvider,
  };

  // Merge provider secrets — blank/undefined retains existing values
  if (patch.mistral !== undefined && patch.mistral !== null) {
    merged.mistral = {
      apiKey: patch.mistral.apiKey || existing.mistral?.apiKey || "",
    };
  } else {
    merged.mistral = existing.mistral;
  }

  if (patch.gemini !== undefined && patch.gemini !== null) {
    merged.gemini = {
      apiKey: patch.gemini.apiKey || existing.gemini?.apiKey || "",
    };
  } else {
    merged.gemini = existing.gemini;
  }

  // Apply active provider change
  if (patch.activeProvider) merged.activeProvider = patch.activeProvider;

  // Safety: never silently activate a cloud provider unless its config is complete.
  // Return an actionable 4xx error so the owner knows what is missing, rather
  // than silently downgrading to Tesseract and claiming success.
  if (merged.activeProvider !== "tesseract" && !isProviderConfigured(merged, merged.activeProvider)) {
    const providerLabel = merged.activeProvider === "mistral" ? "Mistral" : "Gemini";
    throw badRequest(
      `Cannot activate ${providerLabel}: a valid API key is required. ` +
        `Please provide a ${providerLabel} API key in the OCR settings, or select Tesseract.`,
    );
  }

  // Write only canonical fields — legacy googleDocumentAi/veryfi fields are discarded
  await writeEncryptedFile(merged);
  logger.info("OCR private config saved", { activeProvider: merged.activeProvider });
}
