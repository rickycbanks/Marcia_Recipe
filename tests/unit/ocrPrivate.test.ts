import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { ensureDataRoot } from "@/lib/storage/dataRoot";

/* -------------------------------------------------------------------------- */
/*  crypto helpers                                                            */
/* -------------------------------------------------------------------------- */

import {
  encrypt,
  decrypt,
  isKeyringAvailable,
  getEncryptKeyId,
  resetKeyringCache,
} from "@/lib/config/ocrCrypto";
import { AppError } from "@/lib/errors";

function makeKeyringEnv(keyId = "test-key"): string {
  const key = randomBytes(32).toString("base64url");
  return `${keyId}:${key}`;
}

describe("ocrCrypto", () => {
  afterEach(() => {
    delete process.env.PRIVATE_CONFIG_KEYRING;
    resetKeyringCache();
  });

  it("reports no keyring when env is unset", () => {
    expect(isKeyringAvailable()).toBe(false);
    expect(getEncryptKeyId()).toBeNull();
  });

  it("reports keyring availability when env is set", () => {
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv("k1");
    resetKeyringCache();
    expect(isKeyringAvailable()).toBe(true);
    expect(getEncryptKeyId()).toBe("k1");
  });

  it("round-trips plaintext through encrypt/decrypt", () => {
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv("r1");
    resetKeyringCache();
    const plaintext = JSON.stringify({ activeProvider: "mistral" });
    const envelope = encrypt(plaintext);
    expect(envelope).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const decrypted = decrypt(envelope);
    expect(decrypted).toBe(plaintext);
  });

  it("decrypts with rotated (second) key", () => {
    const key1 = randomBytes(32).toString("base64url");
    const key2 = randomBytes(32).toString("base64url");
    process.env.PRIVATE_CONFIG_KEYRING = `k1:${key1}`;
    resetKeyringCache();
    const envelope = encrypt("hello");
    process.env.PRIVATE_CONFIG_KEYRING = `k2:${key2},k1:${key1}`;
    resetKeyringCache();
    expect(decrypt(envelope)).toBe("hello");
  });

  it("throws on tampered ciphertext", () => {
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetKeyringCache();
    const envelope = encrypt("secret");
    const parts = envelope.split(".");
    parts[2] = parts[2]!.slice(0, -2) + "XX";
    expect(() => decrypt(parts.join("."))).toThrow();
  });

  it("throws on tampered auth tag", () => {
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetKeyringCache();
    const envelope = encrypt("secret");
    const parts = envelope.split(".");
    parts[3] = parts[3]!.slice(0, -2) + "XX";
    expect(() => decrypt(parts.join("."))).toThrow();
  });

  it("throws on tampered IV", () => {
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetKeyringCache();
    const envelope = encrypt("secret");
    const parts = envelope.split(".");
    parts[1] = parts[1]!.slice(0, -2) + "XX";
    expect(() => decrypt(parts.join("."))).toThrow();
  });

  it("throws on wrong version prefix", () => {
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetKeyringCache();
    const envelope = encrypt("secret");
    const parts = envelope.split(".");
    parts[0] = "v2";
    expect(() => decrypt(parts.join("."))).toThrow("Unsupported OCR config envelope version");
  });

  it("throws on malformed envelope (wrong dot count)", () => {
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetKeyringCache();
    expect(() => decrypt("v1.too.few")).toThrow("Malformed OCR config envelope");
  });

  it("throws encrypt when no keyring", () => {
    expect(() => encrypt("test")).toThrow("PRIVATE_CONFIG_KEYRING is not configured");
  });

  it("encrypt throws AppError(BAD_REQUEST) when no keyring", () => {
    try {
      encrypt("test");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("BAD_REQUEST");
      expect((err as AppError).status).toBe(400);
    }
  });

  it("throws decrypt when no keyring", () => {
    expect(() => decrypt("v1.x.x.x")).toThrow("PRIVATE_CONFIG_KEYRING is not configured");
  });

  it("decrypt throws AppError(BAD_REQUEST) when no keyring", () => {
    try {
      decrypt("v1.x.x.x");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("BAD_REQUEST");
      expect((err as AppError).status).toBe(400);
    }
  });

  it("handles multiple comma-separated keys", () => {
    const k1 = randomBytes(32).toString("base64url");
    const k2 = randomBytes(32).toString("base64url");
    process.env.PRIVATE_CONFIG_KEYRING = `a:${k1},b:${k2}`;
    resetKeyringCache();
    expect(isKeyringAvailable()).toBe(true);
    expect(getEncryptKeyId()).toBe("a");
    const env = encrypt("data");
    expect(decrypt(env)).toBe("data");
  });

  it("ignores malformed keyring entries", () => {
    const good = randomBytes(32).toString("base64url");
    process.env.PRIVATE_CONFIG_KEYRING = `bad-only-way-too-short,good:${good}`;
    resetKeyringCache();
    expect(isKeyringAvailable()).toBe(true);
    expect(getEncryptKeyId()).toBe("good");
  });
});

/* -------------------------------------------------------------------------- */
/*  ocrPrivate config                                                        */
/* -------------------------------------------------------------------------- */

import {
  getEffectiveOcrProvider,
  getSanitizedOcrConfig,
  savePrivateOcrConfig,
  getMistralSecrets,
  getGeminiSecrets,
} from "@/lib/config/ocrPrivate";
import { recognizeAndExtractRecipe } from "@/lib/imports/providers/dispatcher";

let root: string | undefined;

afterEach(async () => {
  if (root) {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  }
  delete process.env.DATA_ROOT;
  delete process.env.MISTRAL_API_KEY;
  delete process.env.PRIVATE_CONFIG_KEYRING;
  resetEnvCache();
  resetKeyringCache();
  root = undefined;
});

describe("getEffectiveOcrProvider", () => {
  it("returns tesseract when no private config and no env key", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-prov-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await ensureDataRoot();
    expect(await getEffectiveOcrProvider()).toBe("tesseract");
  });

  it("returns mistral when MISTRAL_API_KEY env is set (legacy compat)", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-prov-legacy-"));
    process.env.DATA_ROOT = root;
    process.env.MISTRAL_API_KEY = "test-legacy-key-12345";
    resetEnvCache();
    await ensureDataRoot();
    expect(await getEffectiveOcrProvider()).toBe("mistral");
  });

  it("returns saved provider when private config exists", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-prov-saved-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();
    await savePrivateOcrConfig({ activeProvider: "tesseract" });
    expect(await getEffectiveOcrProvider()).toBe("tesseract");
  });

  it("returns gemini when saved as active provider", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-prov-gemini-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();
    await savePrivateOcrConfig({
      activeProvider: "gemini",
      gemini: { apiKey: "test-gemini-key-123456789" },
    });
    expect(await getEffectiveOcrProvider()).toBe("gemini");
  });
});

describe("getSanitizedOcrConfig", () => {
  it("returns defaults when no config exists", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-sanitized-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await ensureDataRoot();
    const config = await getSanitizedOcrConfig();
    expect(config.activeProvider).toBe("tesseract");
    expect(config.configured.tesseract).toBe(true);
    expect(config.configured.mistral).toBe(false);
    expect(config.configured.gemini).toBe(false);
    expect(config.keyringAvailable).toBe(false);
  });

  it("never exposes secrets", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-sanitized-secrets-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();
    await savePrivateOcrConfig({
      activeProvider: "mistral",
      mistral: { apiKey: "super-secret-key-12345" },
    });
    const config = await getSanitizedOcrConfig();
    expect(config.configured.mistral).toBe(true);
    // Ensure no secret values leaked
    const json = JSON.stringify(config);
    expect(json).not.toContain("super-secret-key");
  });

  it("reports gemini configured when key is present", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-sanitized-gemini-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();
    await savePrivateOcrConfig({
      activeProvider: "gemini",
      gemini: { apiKey: "gemini-key-1234567890" },
    });
    const config = await getSanitizedOcrConfig();
    expect(config.configured.gemini).toBe(true);
    expect(config.configured.mistral).toBe(false);
  });
});

describe("savePrivateOcrConfig", () => {
  it("saves and reads back config", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-save-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();
    await savePrivateOcrConfig({ activeProvider: "tesseract" });
    const config = await getSanitizedOcrConfig();
    expect(config.activeProvider).toBe("tesseract");
  });

  it("retains existing secrets when patch has blank fields", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-save-retain-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();
    await savePrivateOcrConfig({
      activeProvider: "tesseract",
      mistral: { apiKey: "my-secret-key-12345678" },
    });
    // Patch without mistral apiKey — should retain existing
    await savePrivateOcrConfig({ activeProvider: "tesseract" });
    const secrets = await getMistralSecrets();
    expect(secrets?.apiKey).toBe("my-secret-key-12345678");
  });

  it("throws when keyring is missing for cloud provider save", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-save-nokeyring-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();
    await expect(
      savePrivateOcrConfig({ activeProvider: "mistral", mistral: { apiKey: "test" } }),
    ).rejects.toThrow("PRIVATE_CONFIG_KEYRING is not configured");
  });

  it("save throws AppError(BAD_REQUEST) when keyring is missing", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-save-nokeyring-class-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();
    try {
      await savePrivateOcrConfig({ activeProvider: "mistral", mistral: { apiKey: "test" } });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("BAD_REQUEST");
      expect((err as AppError).status).toBe(400);
    }
  });

  it("rejects activation of cloud provider without API key (no silent downgrade)", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-save-fallback-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();
    await expect(
      savePrivateOcrConfig({ activeProvider: "mistral" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Config should still be tesseract — save never succeeded
    const config = await getSanitizedOcrConfig();
    expect(config.activeProvider).toBe("tesseract");
  });

  it("rejects activation of Gemini without API key", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-save-gemini-fallback-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();
    await expect(
      savePrivateOcrConfig({ activeProvider: "gemini" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const config = await getSanitizedOcrConfig();
    expect(config.activeProvider).toBe("tesseract");
  });

  it("allows explicit Tesseract selection without API key", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-save-tesseract-ok-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();
    await savePrivateOcrConfig({ activeProvider: "tesseract" });
    const config = await getSanitizedOcrConfig();
    expect(config.activeProvider).toBe("tesseract");
  });
});

describe("getMistralSecrets", () => {
  it("returns null when no config and no env", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-secrets-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await ensureDataRoot();
    expect(await getMistralSecrets()).toBeNull();
  });

  it("falls back to env MISTRAL_API_KEY", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-secrets-env-"));
    process.env.DATA_ROOT = root;
    process.env.MISTRAL_API_KEY = "env-fallback-key-12345";
    resetEnvCache();
    await ensureDataRoot();
    const secrets = await getMistralSecrets();
    expect(secrets?.apiKey).toBe("env-fallback-key-12345");
  });

  it("prefers config over env", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-secrets-pref-"));
    process.env.DATA_ROOT = root;
    process.env.MISTRAL_API_KEY = "env-key-1234567890";
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();
    await savePrivateOcrConfig({
      activeProvider: "mistral",
      mistral: { apiKey: "config-key-1234567890" },
    });
    const secrets = await getMistralSecrets();
    expect(secrets?.apiKey).toBe("config-key-1234567890");
  });
});

describe("getGeminiSecrets", () => {
  it("returns null when no config", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-gemini-secrets-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    await ensureDataRoot();
    expect(await getGeminiSecrets()).toBeNull();
  });

  it("returns key from config", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-gemini-secrets-config-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();
    await savePrivateOcrConfig({
      activeProvider: "gemini",
      gemini: { apiKey: "gemini-test-key-12345" },
    });
    const secrets = await getGeminiSecrets();
    expect(secrets?.apiKey).toBe("gemini-test-key-12345");
  });
});

/* -------------------------------------------------------------------------- */
/*  Provider dispatcher                                                       */
/* -------------------------------------------------------------------------- */

describe("recognizeAndExtractRecipe (dispatcher)", () => {
  it("rejects Tesseract as server-side (runs in browser)", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-dispatch-"));
    process.env.DATA_ROOT = root;
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();
    await expect(
      recognizeAndExtractRecipe(Buffer.from("x"), "image/png"),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects unsupported mime types for cloud providers", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-dispatch-mime-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    process.env.MISTRAL_API_KEY = "test-key-1234567890";
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();
    await savePrivateOcrConfig({
      activeProvider: "mistral",
      mistral: { apiKey: "test-key-1234567890" },
    });
    await expect(
      recognizeAndExtractRecipe(Buffer.from("x"), "image/gif"),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects oversized images", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-dispatch-size-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();
    await savePrivateOcrConfig({
      activeProvider: "mistral",
      mistral: { apiKey: "test-key-1234567890" },
    });
    const big = Buffer.alloc(10 * 1024 * 1024 + 1);
    await expect(
      recognizeAndExtractRecipe(big, "image/png"),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

/* -------------------------------------------------------------------------- */
/*  Legacy encrypted config migration                                         */
/* -------------------------------------------------------------------------- */

describe("legacy encrypted config migration", () => {
  it("reads a veryfi config and resolves to tesseract without crashing", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-migrate-veryfi-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();

    const { writeFile } = await import("node:fs/promises");
    const { join: pathJoin } = await import("node:path");
    const legacyConfig = {
      activeProvider: "veryfi",
      veryfi: { clientId: "old-client", apiKey: "old-key" },
      mistral: { apiKey: "old-mistral-key" },
    };
    const envelope = encrypt(JSON.stringify(legacyConfig));
    await writeFile(pathJoin(root, "config", "ocr.private.json"), envelope, "utf8");

    const provider = await getEffectiveOcrProvider();
    expect(provider).toBe("tesseract");

    const mistral = await getMistralSecrets();
    expect(mistral?.apiKey).toBe("old-mistral-key");
  });

  it("reads a googleDocumentAi config and resolves to tesseract", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-migrate-gdocai-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();

    const { writeFile } = await import("node:fs/promises");
    const { join: pathJoin } = await import("node:path");
    const legacyConfig = {
      activeProvider: "googleDocumentAi",
      googleDocumentAi: { serviceAccountJson: "{}", projectId: "p", location: "us", processorId: "proc" },
    };
    const envelope = encrypt(JSON.stringify(legacyConfig));
    await writeFile(pathJoin(root, "config", "ocr.private.json"), envelope, "utf8");

    const provider = await getEffectiveOcrProvider();
    expect(provider).toBe("tesseract");
  });

  it("discards legacy fields on save and writes only canonical config", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-migrate-save-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();

    const { readFile, writeFile } = await import("node:fs/promises");
    const { join: pathJoin } = await import("node:path");
    const legacyConfig = {
      activeProvider: "veryfi",
      veryfi: { clientId: "old", apiKey: "old" },
      googleDocumentAi: { serviceAccountJson: "{}", projectId: "p", location: "us", processorId: "proc" },
    };
    const envelope = encrypt(JSON.stringify(legacyConfig));
    await writeFile(pathJoin(root, "config", "ocr.private.json"), envelope, "utf8");

    await savePrivateOcrConfig({ activeProvider: "tesseract" });

    const raw = await readFile(pathJoin(root, "config", "ocr.private.json"), "utf8");
    const decrypted = JSON.parse(decrypt(raw));
    expect(decrypted.activeProvider).toBe("tesseract");
    expect(decrypted.veryfi).toBeUndefined();
    expect(decrypted.googleDocumentAi).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/*  Secrets sanitization                                                      */
/* -------------------------------------------------------------------------- */

describe("secrets sanitization", () => {
  it("sanitized config never contains Mistral API key", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-sanitize-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();

    await savePrivateOcrConfig({
      activeProvider: "mistral",
      mistral: { apiKey: "sk-super-secret-mistral-key-12345" },
    });

    const config = await getSanitizedOcrConfig();
    const json = JSON.stringify(config);
    expect(json).not.toContain("sk-super-secret");
    expect(json).not.toContain("mistral-key");
  });

  it("sanitized config with Gemini never contains API key", async () => {
    root = await mkdtemp(join(tmpdir(), "ocr-sanitize-gemini-"));
    process.env.DATA_ROOT = root;
    process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
    resetEnvCache();
    resetKeyringCache();
    await ensureDataRoot();

    await savePrivateOcrConfig({
      activeProvider: "gemini",
      gemini: { apiKey: "AIzaSy-secret-gemini-key-12345" },
    });

    const config = await getSanitizedOcrConfig();
    const json = JSON.stringify(config);
    expect(json).not.toContain("AIzaSy");
    expect(json).not.toContain("gemini-key");
  });
});
