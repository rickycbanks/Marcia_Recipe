import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import {
  isMistralOcrConfigured,
  recognizeImageWithMistral,
  type MistralResponseLike,
  type RecognizeMistralOptions,
} from "@/lib/imports/mistralOcr";
import { parseRecipeText } from "@/lib/imports/ocr";
import { OCR_LIMITS } from "@/lib/validation/constants";

const API_KEY = "test-key-1234567890";
type FetchImpl = NonNullable<RecognizeMistralOptions["fetchImpl"]>;

function fakeResponse(overrides: Partial<MistralResponseLike> = {}): MistralResponseLike {
  return {
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({}),
    ...overrides,
  };
}

describe("isMistralOcrConfigured", () => {
  it("returns true when MISTRAL_API_KEY is set", () => {
    process.env.MISTRAL_API_KEY = API_KEY;
    resetEnvCache();
    expect(isMistralOcrConfigured()).toBe(true);
  });

  it("returns false when MISTRAL_API_KEY is unset", () => {
    delete process.env.MISTRAL_API_KEY;
    resetEnvCache();
    expect(isMistralOcrConfigured()).toBe(false);
  });
});

describe("recognizeImageWithMistral", () => {
  beforeEach(() => {
    delete process.env.MISTRAL_API_KEY;
    resetEnvCache();
  });

  afterEach(() => {
    delete process.env.MISTRAL_API_KEY;
    resetEnvCache();
  });

  it("builds the correct request and returns the recognized text", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      fakeResponse({
        json: async () => ({
          pages: [{ index: 0, markdown: "Hello" }],
          model: "mistral-ocr-latest",
          usage_info: {},
        }),
      }),
    );
    const text = await recognizeImageWithMistral(Buffer.from("fake-image-bytes"), "image/png", {
      fetchImpl,
      apiKey: API_KEY,
    });

    expect(text).toBe("Hello");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call as [string, RequestInit];
    expect(url).toBe("https://api.mistral.ai/v1/ocr");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(init.body).toBeTruthy();
    const body = JSON.parse(String(init.body)) as { model: string; document: { image_url: string } };
    expect(body.model).toBe("mistral-ocr-latest");
    expect(body.document.image_url).toMatch(/^data:image\/png;base64,/);
  });

  it("joins multiple page markdown blocks with separators", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      fakeResponse({
        json: async () => ({
          pages: [
            { index: 0, markdown: "First" },
            { index: 1, markdown: "Second" },
          ],
        }),
      }),
    );
    const text = await recognizeImageWithMistral(Buffer.from("x"), "image/jpeg", { fetchImpl, apiKey: API_KEY });
    expect(text).toBe("First\n\n---\n\nSecond");
  });

  it("filters empty page markdown when joining", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      fakeResponse({
        json: async () => ({
          pages: [
            { index: 0, markdown: "First" },
            { index: 1, markdown: "   " },
            { index: 2, markdown: "Third" },
          ],
        }),
      }),
    );
    const text = await recognizeImageWithMistral(Buffer.from("x"), "image/png", { fetchImpl, apiKey: API_KEY });
    expect(text).toBe("First\n\n---\n\nThird");
  });

  it("throws an upstreamFetch error on a non-2xx response", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      fakeResponse({ ok: false, status: 401, text: async () => "unauthorized" }),
    );
    await expect(
      recognizeImageWithMistral(Buffer.from("x"), "image/png", { fetchImpl, apiKey: API_KEY }),
    ).rejects.toMatchObject({ code: "UPSTREAM_FETCH", status: 502 });
  });

  it("wraps network failures in an upstreamFetch AppError", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(
      recognizeImageWithMistral(Buffer.from("x"), "image/png", { fetchImpl, apiKey: API_KEY }),
    ).rejects.toMatchObject({ code: "UPSTREAM_FETCH", status: 502, detail: { cause: "fetch failed" } });
  });

  it("throws an upstreamFetch error when the response has no pages", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => fakeResponse({ json: async () => ({ pages: [] }) }));
    await expect(
      recognizeImageWithMistral(Buffer.from("x"), "image/png", { fetchImpl, apiKey: API_KEY }),
    ).rejects.toMatchObject({ code: "UPSTREAM_FETCH" });
  });

  it("throws badRequest for an unsupported mime type", async () => {
    await expect(
      recognizeImageWithMistral(Buffer.from("x"), "image/gif", { apiKey: API_KEY }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("throws payloadTooLarge when the buffer exceeds the OCR limit", async () => {
    const big = Buffer.alloc(OCR_LIMITS.maxImageBytes + 1);
    await expect(recognizeImageWithMistral(big, "image/png", { apiKey: API_KEY })).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
    });
  });

  it("throws badRequest when no API key is configured", async () => {
    await expect(recognizeImageWithMistral(Buffer.from("x"), "image/png")).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("parseRecipeText markdown sections", () => {
  it("keeps generic headings out of the title and parses section metadata", () => {
    const markdown = `# Orchard Skillet Cakes
## Description
Short description.
- 2 servings of context
## Yield
Makes 6 cakes
## Total Time
30 minutes
## Prep Time
10 minutes
## Cook Time
20 minutes
## Ingredients
- 1 cup grain-free flour
- 2 tablespoons neutral oil
- 1 medium fruit
- 1 teaspoon leavener
## Instructions
1. Combine dry ingredients.
2. Add wet ingredients.
3. Cook in a skillet.
## Notes
Serve warm.`;

    const draft = parseRecipeText(markdown);

    expect(draft.title).toBe("Orchard Skillet Cakes");
    expect(draft.title).not.toBe("Description");
    expect(draft.servings).toBe(6);
    expect(draft.prepMinutes).toBe(10);
    expect(draft.cookMinutes).toBe(20);
    expect(draft.ingredients).toHaveLength(4);
    expect(draft.steps).toHaveLength(3);
    expect(draft.notesMarkdown).toContain("Serve warm");
  });

  it("does not use Description as a title when no title heading exists", () => {
    const markdown = `## Description
Orchard Skillet Cakes
Short description.
## Ingredients
- 1 cup flour
- 2 eggs
## Instructions
1. Mix.
2. Cook.`;

    const draft = parseRecipeText(markdown);

    expect(draft.title).toBe("Orchard Skillet Cakes");
    expect(draft.title).not.toBe("Description");
  });

  it("parses divider-delimited Jina markdown without inventing servings", () => {
    const markdown = `Title: Orchard Skillet Cakes
URL Source: https://example.test/pancakes
Markdown Content:
### Description
A short pancake description.
* * *
**Pancakes**
* 3/4 cup [full fat coconut milk](https://example.test/coconut)
* 1 tsp vanilla extract
* 1 medium banana
* coconut oil for frying
* * *
1. Combine the ingredients.
2. Heat a skillet.
3. Cook the cakes.
### Notes
* Serve warm.
* Prep Time:10 minutes
* Cook Time:20 minutes`;

    const draft = parseRecipeText(markdown);

    expect(draft.title).toBe("Orchard Skillet Cakes");
    expect(draft.prepMinutes).toBe(10);
    expect(draft.cookMinutes).toBe(20);
    expect(draft.servings).toBeNull();
    expect(draft.ingredients).toHaveLength(4);
    expect(draft.ingredients).toContainEqual({ quantity: 0.75, unit: "cup", name: "full fat coconut milk", note: null });
    expect(draft.steps).toHaveLength(3);
    expect(draft.steps).not.toContain("Prep Time:10 minutes");
    expect(draft.steps).not.toContain("Cook Time:20 minutes");
  });
});
