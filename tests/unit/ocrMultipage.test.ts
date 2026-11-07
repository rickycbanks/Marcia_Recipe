/**
 * No-network tests for multi-page cloud OCR.
 * All provider calls are intercepted via fetch seams — no real API keys or
 * network calls are made. Tests verify:
 *   - Pass 1 runs once per page, in the submitted order (per-provider)
 *   - Page texts are joined and parsed by a single pass-2 call
 *   - A failing page aborts the request naming the 1-based page number
 *   - Multi-page limits (page count, combined size) are enforced before any
 *     provider call is made
 *   - Pass-2 failure falls back to the heuristic parser on combined text
 */

import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { ensureDataRoot } from "@/lib/storage/dataRoot";
import { resetKeyringCache } from "@/lib/config/ocrCrypto";
import { savePrivateOcrConfig } from "@/lib/config/ocrPrivate";
import { OCR_LIMITS } from "@/lib/validation/constants";
import { recognizeAndExtractRecipePages } from "@/lib/imports/providers/dispatcher";
import { recognizeAndExtractWithMistralPages } from "@/lib/imports/providers/mistral";
import { recognizeAndExtractWithGeminiPages } from "@/lib/imports/providers/gemini";
import type { OcrPageImage } from "@/lib/imports/providers/dispatcher";

function makeKeyringEnv(keyId = "test-key"): string {
  const key = randomBytes(32).toString("base64url");
  return `${keyId}:${key}`;
}

function page(contents: string, mimeType = "image/png"): OcrPageImage {
  return { buffer: Buffer.from(contents), mimeType };
}

function dataUri(image: OcrPageImage): string {
  return `data:${image.mimeType};base64,${image.buffer.toString("base64")}`;
}

const structuredJson = (title: string) =>
  JSON.stringify({
    title,
    description: null,
    prepMinutes: null,
    cookMinutes: null,
    totalMinutes: null,
    servings: null,
    ingredients: [{ quantity: "1", unit: "cup", name: "flour", note: null }],
    steps: ["Mix."],
    notes: null,
  });

describe("multi-page OCR (shared setup)", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) {
      const { rm } = await import("node:fs/promises");
      await rm(root, { recursive: true, force: true });
    }
    delete process.env.DATA_ROOT;
    delete process.env.PRIVATE_CONFIG_KEYRING;
    resetEnvCache();
    resetKeyringCache();
    root = undefined;
  });

  describe("recognizeAndExtractWithMistralPages (no-network)", () => {
    it("runs pass 1 per page in order and passes joined text to a single pass 2", async () => {
      root = await mkdtemp(join(tmpdir(), "ocr-mistral-multi-"));
      process.env.DATA_ROOT = root;
      process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
      resetEnvCache();
      resetKeyringCache();
      await ensureDataRoot();
      await savePrivateOcrConfig({
        activeProvider: "mistral",
        mistral: { apiKey: "test-mistral-key-12345" },
      });

      const page1 = page("fake-image-one");
      const page2 = page("fake-image-two");
      const page3 = page("fake-image-three");
      const page1Text = "# Pancakes\n## Ingredients\n- 1 cup flour";
      const page2Text = "- 2 eggs\n## Instructions\n1. Mix.";
      const page3Text = "2. Cook until golden.";

      const ocrCalls: string[] = [];
      const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
        const body = init?.body ? JSON.parse(String(init.body)) : null;

        if (urlStr.includes("/v1/ocr")) {
          ocrCalls.push(body.document?.image_url ?? "");
          const which = ocrCalls.length;
          const markdown = which === 1 ? page1Text : which === 2 ? page2Text : page3Text;
          return new Response(JSON.stringify({ pages: [{ markdown }] }), { status: 200 });
        }
        if (urlStr.includes("/v1/chat/completions")) {
          // Single pass-2 call receiving all three pages joined in order
          expect(body.messages[1].content).toContain(page1Text);
          expect(body.messages[1].content).toContain(`${page2Text}\n\n${page3Text}`);
          return new Response(
            JSON.stringify({ choices: [{ message: { content: structuredJson("Pancakes") } }] }),
            { status: 200 },
          );
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await recognizeAndExtractWithMistralPages(
        [page1, page2, page3],
        fetchImpl as unknown as typeof fetch,
      );

      expect(result.status).toBe("ai-normalized");
      expect(result.draft.title).toBe("Pancakes");
      // Pass 1 ran once per page, in the submitted order
      expect(ocrCalls).toEqual([dataUri(page1), dataUri(page2), dataUri(page3)]);
      // Exactly one pass-2 call
      expect(fetchImpl).toHaveBeenCalledTimes(4);
    });

    it("aborts with a page number when one page fails OCR", async () => {
      root = await mkdtemp(join(tmpdir(), "ocr-mistral-pagefail-"));
      process.env.DATA_ROOT = root;
      process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
      resetEnvCache();
      resetKeyringCache();
      await ensureDataRoot();
      await savePrivateOcrConfig({
        activeProvider: "mistral",
        mistral: { apiKey: "test-mistral-key-12345" },
      });

      const fetchImpl = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes("/v1/ocr")) {
          const ocrCalls = fetchImpl.mock.calls.filter(
            (call) => String((call as unknown[])[0]).includes("/v1/ocr"),
          ).length;
          if (ocrCalls === 1) {
            return new Response(JSON.stringify({ pages: [{ markdown: "# Soup" }] }), { status: 200 });
          }
          // Second page fails recognition
          return new Response("Service unavailable", { status: 503 });
        }
        return new Response("Not found", { status: 404 });
      });

      await expect(
        recognizeAndExtractWithMistralPages([page("p1"), page("p2")], fetchImpl as unknown as typeof fetch),
      ).rejects.toMatchObject({ code: "UPSTREAM_FETCH", message: expect.stringContaining("page 2") });
    });

    it("falls back to the heuristic parser on combined text when pass 2 fails", async () => {
      root = await mkdtemp(join(tmpdir(), "ocr-mistral-multifallback-"));
      process.env.DATA_ROOT = root;
      process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
      resetEnvCache();
      resetKeyringCache();
      await ensureDataRoot();
      await savePrivateOcrConfig({
        activeProvider: "mistral",
        mistral: { apiKey: "test-mistral-key-12345" },
      });

      const fetchImpl = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes("/v1/ocr")) {
          const which = fetchImpl.mock.calls.filter(
            (call) => String((call as unknown[])[0]).includes("/v1/ocr"),
          ).length;
          const markdown =
            which === 1
              ? "# Soup\n## Ingredients\n- 1 cup water"
              : "- 2 carrots\n## Instructions\n1. Boil.\n2. Season.";
          return new Response(JSON.stringify({ pages: [{ markdown }] }), { status: 200 });
        }
        // Pass 2 fails
        return new Response("Internal error", { status: 500 });
      });

      const result = await recognizeAndExtractWithMistralPages(
        [page("p1"), page("p2")],
        fetchImpl as unknown as typeof fetch,
      );

      expect(result.status).toBe("heuristic-fallback");
      expect(result.draft.title).toBe("Soup");
      // Both pages' steps survived concatenation and one combined parse
      expect(result.draft.steps).toContain("Boil.");
      expect(result.draft.steps).toContain("Season.");
    });
  });

  describe("recognizeAndExtractWithGeminiPages (no-network)", () => {
    it("runs pass 1 per page in order and passes joined text to a single pass 2", async () => {
      root = await mkdtemp(join(tmpdir(), "ocr-gemini-multi-"));
      process.env.DATA_ROOT = root;
      process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
      resetEnvCache();
      resetKeyringCache();
      await ensureDataRoot();
      await savePrivateOcrConfig({
        activeProvider: "gemini",
        gemini: { apiKey: "test-gemini-key-123456789" },
      });

      const page1Text = "# Chocolate Cake\n## Ingredients\n- 2 cups flour";
      const page2Text = "## Instructions\n1. Mix.\n2. Bake.";
      const base64ByCall: string[] = [];

      const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
        const body = init?.body ? JSON.parse(String(init.body)) : null;

        if (urlStr.includes("generateContent")) {
          const hasImage = body?.contents?.[0]?.parts?.some(
            (p: { inlineData?: unknown }) => p.inlineData,
          );
          if (hasImage) {
            base64ByCall.push(body.contents[0].parts.find((p: { inlineData?: unknown }) => p.inlineData).inlineData.data);
            const markdown = base64ByCall.length === 1 ? page1Text : page2Text;
            return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: markdown }] } }] }), { status: 200 });
          }
          // Pass 2 must receive both pages joined, with no images
          expect(body.contents[0].parts[0].text).toContain(`${page1Text}\n\n${page2Text}`);
          expect(body.contents[0].parts.some((p: { inlineData?: unknown }) => p.inlineData)).toBe(false);
          return new Response(
            JSON.stringify({ candidates: [{ content: { parts: [{ text: structuredJson("Chocolate Cake") }] } }] }),
            { status: 200 },
          );
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await recognizeAndExtractWithGeminiPages(
        [page("cake-page-1"), page("cake-page-2")],
        fetchImpl as unknown as typeof fetch,
      );

      expect(result.status).toBe("ai-normalized");
      expect(result.draft.title).toBe("Chocolate Cake");
      expect(base64ByCall).toEqual([
        Buffer.from("cake-page-1").toString("base64"),
        Buffer.from("cake-page-2").toString("base64"),
      ]);
    });
  });

  describe("recognizeAndExtractRecipePages limits (no-network)", () => {
    it("rejects more pages than the limit before any provider call", async () => {
      root = await mkdtemp(join(tmpdir(), "ocr-multi-count-"));
      process.env.DATA_ROOT = root;
      process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
      resetEnvCache();
      resetKeyringCache();
      await ensureDataRoot();
      await savePrivateOcrConfig({
        activeProvider: "mistral",
        mistral: { apiKey: "test-mistral-key-12345" },
      });

      const fetchImpl = vi.fn();
      const tooMany = Array.from({ length: OCR_LIMITS.maxPages + 1 }, (_, index) => page(`p${index}`));
      await expect(
        recognizeAndExtractRecipePages(tooMany, { fetchImpl: fetchImpl as unknown as typeof fetch }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("rejects combined images over the total size limit before any provider call", async () => {
      root = await mkdtemp(join(tmpdir(), "ocr-multi-total-"));
      process.env.DATA_ROOT = root;
      process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
      resetEnvCache();
      resetKeyringCache();
      await ensureDataRoot();
      await savePrivateOcrConfig({
        activeProvider: "mistral",
        mistral: { apiKey: "test-mistral-key-12345" },
      });

      const fetchImpl = vi.fn();
      // Four pages, each individually under maxImageBytes, over the total cap.
      const chunkBytes = Math.ceil((OCR_LIMITS.maxTotalImageBytes + 1) / 4);
      const images = Array.from({ length: 4 }, () => ({
        buffer: Buffer.alloc(chunkBytes),
        mimeType: "image/png",
      }));
      expect(images[0]!.buffer.byteLength).toBeLessThanOrEqual(OCR_LIMITS.maxImageBytes);
      await expect(
        recognizeAndExtractRecipePages(images, { fetchImpl: fetchImpl as unknown as typeof fetch }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("rejects an empty image list", async () => {
      root = await mkdtemp(join(tmpdir(), "ocr-multi-empty-"));
      process.env.DATA_ROOT = root;
      process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
      resetEnvCache();
      resetKeyringCache();
      await ensureDataRoot();
      await savePrivateOcrConfig({
        activeProvider: "mistral",
        mistral: { apiKey: "test-mistral-key-12345" },
      });

      const fetchImpl = vi.fn();
      await expect(
        recognizeAndExtractRecipePages([], { fetchImpl: fetchImpl as unknown as typeof fetch }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("names the page index when a single page has an unsupported type", async () => {
      root = await mkdtemp(join(tmpdir(), "ocr-multi-mime-"));
      process.env.DATA_ROOT = root;
      process.env.PRIVATE_CONFIG_KEYRING = makeKeyringEnv();
      resetEnvCache();
      resetKeyringCache();
      await ensureDataRoot();
      await savePrivateOcrConfig({
        activeProvider: "mistral",
        mistral: { apiKey: "test-mistral-key-12345" },
      });

      const fetchImpl = vi.fn();
      await expect(
        recognizeAndExtractRecipePages(
          [page("p1"), { ...page("p2"), mimeType: "image/webp" }],
          { fetchImpl: fetchImpl as unknown as typeof fetch },
        ),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("page 2") });
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });
});
