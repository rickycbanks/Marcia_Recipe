# Cookbook OCR evaluation

Evaluation date: 2026-10-15. Four local cookbook photographs and site-exported Markdown
files under `recipeocrimprovement/` were used. These fixtures are ignored by Git.
Exports are evidence of earlier imports and manual edits, **not ground truth**; inspect
the actual photograph for disputed values. No saved recipes or site credentials are changed.

## Findings

OCR and recipe extraction have separate failure modes. On the same cached OCR text:

| Check | Original 3B model and prompt | Updated Small model and prompt |
| --- | --- | --- |
| Biscuit ingredients | 13; optional honey omitted | All 14, including honey |
| Biscuit annotations | Final scoop note omitted; other notes shortened | Final scoop note and handwritten step addition retained |
| Strawberry measurement | ½ strawberries, missing cup | ½ cup strawberries |
| Garlic in tzatziki | “clove garlic” placed in name | quantity 1, unit clove, name garlic |
| Guacamole volume yield | 2 cups interpreted as 2 servings | servings unset; volume yield in notes |
| Guacamole method | Correct in this fresh baseline, incorrect in site export | Correct main method, storage kept in notes |

The fraction normalizer also now handles actual `\frac{1}{2}` and mixed-number
LaTeX from OCR before extraction (and in the heuristic fallback), preserving line breaks.
The previous helper handled only parenthesized slash fractions.

The final production-path evaluation returned `ai-normalized` for all four samples,
with 14/6/6/7 ingredients respectively. Extraction-only times on that run were roughly
2–4.4 seconds. These are small-sample observations, not an accuracy score or latency SLA.
Mistral Small has different token pricing from Ministral 3B; no fixed cost estimate is assumed.
The shared cookbook prompt also applies to Gemini; Gemini was covered by mocked tests,
but was not evaluated against its live API.

The sideways guacamole photograph produced **½ instead of the photographed ⅓** in
OCR. Repeating OCR after rotating the image 270 degrees produced ⅓. Its EXIF orientation
is 1, so EXIF alone cannot detect this problem. Text extraction cannot recover a fraction
that OCR already misread. Supplying the sideways image to the second model did not fix
this in the experiment, so image-assisted extraction was not added. A fresh end-to-end
run of the final pipeline on the upright photo returned the correct 0.333 cup cilantro
quantity, six ingredients, and the main method in about six seconds. Results are in
`local/ocr-evaluation/upright/`.

Remaining limitations: upload upright photos and check ingredient amounts before saving.
OCR may misread handwriting. Models can still split an unnumbered paragraph into multiple
steps despite the prompt; the strawberry method was split into two steps in the final run
without losing its text. Models behind `-latest` aliases can change, so rerun evaluation
when investigating a regression. Automated conversion tests do not establish live model quality.

## Reproduce inside the distrobox

Start the existing `marcia-dev` container, then run from the recipe repository:

```sh
podman start marcia-dev
podman exec --user ricky --workdir /home/ricky/Projects/Marcia_Recipe marcia-dev \
  node --import tsx scripts/benchmark-ocr.ts \
  --key-file /path/to/mistral-key.txt \
  --out local/ocr-evaluation/live
```

This is opt-in and makes paid API requests. The key file can contain a bare key or a
label followed by the key as its last whitespace-separated token. Alternatively set
`MISTRAL_API_KEY` inside the container. The script uses an isolated temporary DATA_ROOT;
it does not read or modify the site's private configuration. Output is kept under the
already ignored `local/` directory and contains source text and drafts, never the key.

Outputs include OCR responses, extraction JSON, validated drafts, and a summary with
image hashes, model identifiers, token usage, timing, fallback status, and ingredient
counts. Artifacts are named `<fixture-dir>--<image-stem>.*` so identically named images
in different fixture folders do not overwrite each other. Counts against exports are
diagnostics only; they do not measure correctness.
A run returns a failing exit code if any recipe uses heuristic fallback.

To test only extraction with cached OCR, append:

```sh
--cached-ocr local/ocr-evaluation/live --out local/ocr-evaluation/replay
```

To compare extraction models under the **current** prompt, append `--model ministral-3b-2512`.
For an exact earlier baseline, use that revision's prompt and schema too. Cache replay
makes no OCR calls; it still makes extraction calls. Supply a cache that corresponds to
the selected images (files are named `<image-stem>.ocr.json`). The initial experiment
artifacts are in `/tmp/recipe-ocr-eval/`; final production-path results are in
`local/ocr-evaluation/final/`. Temporary artifacts may be removed by the system.

```sh
podman exec --user ricky --workdir /home/ricky/Projects/Marcia_Recipe marcia-dev npm test
podman exec --user ricky --workdir /home/ricky/Projects/Marcia_Recipe marcia-dev npm run typecheck
podman exec --user ricky --workdir /home/ricky/Projects/Marcia_Recipe marcia-dev npm run lint
```
