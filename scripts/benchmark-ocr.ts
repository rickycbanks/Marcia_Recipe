/** Opt-in live evaluation; never runs as part of the unit suite. */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { recognizeAndExtractWithMistral } from "../src/lib/imports/providers/mistral";
import { resetEnvCache } from "../src/lib/env";

const { values } = parseArgs({ options: {
  "key-file": { type: "string" }, fixtures: { type: "string", default: "recipeocrimprovement" },
  out: { type: "string", default: "local/ocr-evaluation" },
  "cached-ocr": { type: "string" }, model: { type: "string" },
} });
const key = values["key-file"]
  ? (await readFile(values["key-file"], "utf8")).trim().split(/\s+/).at(-1)
  : process.env.MISTRAL_API_KEY;
if (!key) throw new Error("Provide --key-file or MISTRAL_API_KEY.");
// Isolate configuration from the site's encrypted credentials and mutable data.
const dataRoot = await mkdtemp(join(tmpdir(), "recipe-ocr-benchmark-"));
process.env.DATA_ROOT = dataRoot;
process.env.MISTRAL_API_KEY = key;
resetEnvCache();
const fixtures = resolve(values.fixtures!);
const out = resolve(values.out!);
await mkdir(out, { recursive: true });
const summary = [];
try {
  for (const dir of (await readdir(fixtures, { withFileTypes: true })).filter(d => d.isDirectory())) {
    const folder = join(fixtures, dir.name);
    const files = await readdir(folder);
    const imageName = files.find(f => /\.(jpg|jpeg|png|avif)$/i.test(f));
    const exportName = files.find(f => f.endsWith(".md"));
    if (!imageName) continue;
    const image = await readFile(join(folder, imageName));
    const stem = basename(imageName).replace(/\.[^.]+$/, "");
    // Namespace artifacts by fixture directory so identically named images in
    // different fixture folders cannot overwrite each other's outputs.
    const outName = `${dir.name.replace(/[^\w.-]+/g, "-")}--${stem}`;
    const mime = /\.png$/i.test(imageName) ? "image/png" : /\.avif$/i.test(imageName) ? "image/avif" : "image/jpeg";
    const started = Date.now();
    const metadata: Record<string, unknown> = {};
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/ocr") && values["cached-ocr"]) {
        // Explicitly supplied cache is useful to compare extraction independently.
        const cached = await readFile(join(resolve(values["cached-ocr"]), `${stem}.ocr.json`), "utf8");
        return new Response(cached, { status: 200 });
      }
      const body = JSON.parse(String(init?.body));
      if (url.endsWith("/chat/completions") && values.model) body.model = values.model;
      const response = await fetch(input, { ...init, body: JSON.stringify(body) });
      if (response.ok) {
        const data = await response.clone().json();
        if (url.endsWith("/ocr")) {
          await writeFile(join(out, `${outName}.ocr.json`), JSON.stringify(data, null, 2));
          metadata.ocrModel = data.model ?? body.model;
        } else {
          metadata.extractionModel = data.model ?? body.model;
          metadata.usage = data.usage;
          await writeFile(join(out, `${outName}.extraction.json`), data.choices[0].message.content);
        }
      }
      return response;
    };
    const result = await recognizeAndExtractWithMistral(image, mime, fetchImpl);
    const exported = exportName ? await readFile(join(folder, exportName), "utf8") : "";
    const ingredientBlock = /## Ingredients\s*\n([\s\S]*?)(?=\n## |$)/.exec(exported)?.[1] ?? "";
    const row = {
      fixture: dir.name, imageSha256: createHash("sha256").update(image).digest("hex"),
      cachedOcr: Boolean(values["cached-ocr"]), ...metadata, elapsedMs: Date.now() - started,
      status: result.status, ingredients: result.draft.ingredients.length,
      exportedIngredients: (ingredientBlock.match(/^[-*] /gm) ?? []).length,
      steps: result.draft.steps.length,
    };
    await writeFile(join(out, `${outName}.draft.json`), JSON.stringify(result, null, 2));
    summary.push(row);
    console.log(JSON.stringify(row));
  }
  await writeFile(join(out, "summary.json"), JSON.stringify(summary, null, 2));
  if (!summary.length) throw new Error("No recipe images found in fixture subdirectories.");
  if (summary.some(row => row.status !== "ai-normalized")) process.exitCode = 1;
} finally {
  await rm(dataRoot, { recursive: true, force: true });
}
