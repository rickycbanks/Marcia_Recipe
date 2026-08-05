import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { RecipeDraft } from "@/types";
import {
  parseIngredientLine,
  parseIsoDuration,
  parseMinutesFromText,
  parseServings,
  sanitizeText,
} from "./textParsing";

/**
 * Recipe extraction from HTML: schema.org JSON-LD first, then Microdata,
 * then RDFa, then WP Recipe Maker (a class-based fallback for WordPress
 * recipe plugins that publish no structured data). All extracted text is
 * sanitized (cheerio .text() never returns markup, and sanitizeText strips
 * control characters). The result is a DRAFT — nothing is persisted until
 * the owner reviews and saves it.
 */

export interface ExtractedRecipe {
  draft: RecipeDraft;
  via: "json-ld" | "microdata" | "rdfa" | "wprm";
}

type JsonObject = Record<string, unknown>;

function emptyDraft(): RecipeDraft {
  return {
    visibility: "inherit",
    title: "",
    description: "",
    prepMinutes: null,
    cookMinutes: null,
    servings: null,
    difficulty: null,
    category: null,
    tags: [],
    sourceUrl: null,
    bookTitle: null,
    bookAuthor: null,
    bookPage: null,
    ingredients: [],
    steps: [],
    notesMarkdown: "",
    stagedMedia: [],
  };
}

function toStringArray(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

function typeIncludesRecipe(node: JsonObject): boolean {
  const type = node["@type"];
  if (type === "Recipe") return true;
  if (Array.isArray(type)) return type.includes("Recipe");
  return false;
}

/** Flatten JSON-LD documents (arrays, @graph) to find Recipe nodes. */
function findJsonLdRecipes($: cheerio.CheerioAPI): JsonObject[] {
  const recipes: JsonObject[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // malformed JSON-LD is common in the wild — skip that block
    }
    const nodes: JsonObject[] = [];
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(visit);
      } else if (node && typeof node === "object") {
        const obj = node as JsonObject;
        nodes.push(obj);
        if (Array.isArray(obj["@graph"])) visit(obj["@graph"]);
      }
    };
    visit(parsed);
    for (const node of nodes) {
      if (typeIncludesRecipe(node)) recipes.push(node);
    }
  });
  return recipes;
}

function instructionsToSteps(value: unknown): string[] {
  const steps: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      const text = sanitizeText(node);
      if (text) steps.push(text);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node && typeof node === "object") {
      const obj = node as JsonObject;
      const type = obj["@type"];
      const types = Array.isArray(type) ? type : [type];
      if (types.includes("HowToStep") && typeof obj.text === "string") {
        const text = sanitizeText(obj.text);
        if (text) steps.push(text);
        return;
      }
      if (types.includes("HowToSection")) {
        visit(obj.itemListElement);
        return;
      }
      if (typeof obj.text === "string") {
        const text = sanitizeText(obj.text);
        if (text) steps.push(text);
      } else if (obj.itemListElement) {
        visit(obj.itemListElement);
      }
    }
  };
  visit(value);
  return steps.filter((s) => s.length > 0).slice(0, 100);
}

function jsonLdToDraft(node: JsonObject, sourceUrl: string | null): RecipeDraft {
  const draft = emptyDraft();
  draft.title = sanitizeText(String(node.name ?? "")).slice(0, 200);
  draft.description = sanitizeText(String(node.description ?? "")).slice(0, 2000);
  draft.prepMinutes = parseIsoDuration(node.prepTime);
  draft.cookMinutes = parseIsoDuration(node.cookTime);
  draft.servings = parseServings(node.recipeYield);
  const category = Array.isArray(node.recipeCategory) ? node.recipeCategory[0] : node.recipeCategory;
  draft.category = typeof category === "string" ? sanitizeText(category).slice(0, 60) || null : null;
  draft.tags = toStringArray(node.keywords)
    .flatMap((k) => k.split(","))
    .map((k) => sanitizeText(k))
    .filter(Boolean)
    .slice(0, 20);
  draft.sourceUrl = sourceUrl;
  draft.ingredients = toStringArray(node.recipeIngredient)
    .map(parseIngredientLine)
    .filter((i): i is NonNullable<typeof i> => i !== null)
    .slice(0, 200);
  draft.steps = instructionsToSteps(node.recipeInstructions);
  return draft;
}

/* ------------------------------- microdata ---------------------------------- */

function propTexts($: cheerio.CheerioAPI, scope: cheerio.Cheerio<AnyNode>, prop: string): string[] {
  const values: string[] = [];
  scope
    .find(`[itemprop="${prop}"]`)
    .addBack(`[itemprop="${prop}"]`)
    .each((_, el) => {
      const $el = $(el);
      const content = $el.attr("content") ?? $el.attr("datetime") ?? $el.text();
      const text = sanitizeText(content ?? "");
      if (text) values.push(text);
    });
  return values;
}

function microdataToDraft($: cheerio.CheerioAPI, sourceUrl: string | null): RecipeDraft | null {
  const scope = $('[itemscope][itemtype*="schema.org/Recipe"], [itemscope][itemtype*="/Recipe"]').first();
  if (scope.length === 0) return null;
  const draft = emptyDraft();
  draft.title = propTexts($, scope, "name")[0]?.slice(0, 200) ?? "";
  draft.description = propTexts($, scope, "description")[0]?.slice(0, 2000) ?? "";
  draft.prepMinutes = parseIsoDuration(propTexts($, scope, "prepTime")[0]);
  draft.cookMinutes = parseIsoDuration(propTexts($, scope, "cookTime")[0]);
  draft.servings = parseServings(propTexts($, scope, "recipeYield")[0]);
  draft.category = propTexts($, scope, "recipeCategory")[0]?.slice(0, 60) ?? null;
  draft.tags = propTexts($, scope, "keywords")
    .flatMap((k) => k.split(","))
    .map((k) => sanitizeText(k))
    .filter(Boolean)
    .slice(0, 20);
  draft.sourceUrl = sourceUrl;
  draft.ingredients = propTexts($, scope, "recipeIngredient")
    .map(parseIngredientLine)
    .filter((i): i is NonNullable<typeof i> => i !== null)
    .slice(0, 200);
  const instructionScope = scope.find('[itemprop="recipeInstructions"]');
  const steps: string[] = [];
  if (instructionScope.length > 0) {
    instructionScope.each((_, el) => {
      const $el = $(el);
      const stepEls = $el.find('[itemprop="itemListElement"], [itemprop="text"]');
      if (stepEls.length > 0) {
        stepEls.each((__, stepEl) => {
          const text = sanitizeText($(stepEl).text());
          if (text) steps.push(text);
        });
      } else {
        const text = sanitizeText($el.text());
        if (text) steps.push(text);
      }
    });
  }
  draft.steps = steps.slice(0, 100);
  return draft.title ? draft : null;
}

/* ---------------------------------- RDFa ------------------------------------ */

function rdfaToDraft($: cheerio.CheerioAPI, sourceUrl: string | null): RecipeDraft | null {
  const scope = $('[typeof*="schema:Recipe"], [vocab*="schema.org"][typeof*="Recipe"]').first();
  if (scope.length === 0) return null;
  const prop = (name: string): string[] => {
    const values: string[] = [];
    scope.find(`[property="schema:${name}"], [property="${name}"]`).each((_, el) => {
      const $el = $(el);
      const text = sanitizeText($el.attr("content") ?? $el.text());
      if (text) values.push(text);
    });
    return values;
  };
  const draft = emptyDraft();
  draft.title = prop("name")[0]?.slice(0, 200) ?? "";
  if (!draft.title) return null;
  draft.description = prop("description")[0]?.slice(0, 2000) ?? "";
  draft.prepMinutes = parseIsoDuration(prop("prepTime")[0]);
  draft.cookMinutes = parseIsoDuration(prop("cookTime")[0]);
  draft.servings = parseServings(prop("recipeYield")[0]);
  draft.sourceUrl = sourceUrl;
  draft.ingredients = prop("recipeIngredient")
    .map(parseIngredientLine)
    .filter((i): i is NonNullable<typeof i> => i !== null)
    .slice(0, 200);
  draft.steps = prop("recipeInstructions").slice(0, 100);
  return draft;
}

/* ----------------------------- WP Recipe Maker ------------------------------- */

/** Read a wprm time field: prefer the ISO `datetime` attr, then the text. */
function wprmMinutes($: cheerio.CheerioAPI, scope: cheerio.Cheerio<AnyNode>, selector: string): number | null {
  const el = scope.find(selector).first();
  if (el.length === 0) return null;
  const fromAttr = parseIsoDuration(el.attr("datetime"));
  if (fromAttr !== null) return fromAttr;
  return parseMinutesFromText(el.text());
}

/**
 * WP Recipe Maker fallback: the plugin renders recipe data as plain HTML with
 * `wprm-recipe` CSS classes (no JSON-LD/Microdata/RDFa). Returns null when the
 * page has no `.wprm-recipe` container or the container has no title.
 */
function wprmToDraft($: cheerio.CheerioAPI, sourceUrl: string | null): RecipeDraft | null {
  const scope = $(".wprm-recipe").first();
  if (scope.length === 0) return null;

  const draft = emptyDraft();
  draft.title = sanitizeText(scope.find(".wprm-recipe-name").first().text()).slice(0, 200);
  if (!draft.title) return null;

  draft.description = sanitizeText(scope.find(".wprm-recipe-summary").first().text()).slice(0, 2000);
  draft.notesMarkdown = sanitizeText(scope.find(".wprm-recipe-notes").first().text()).slice(0, 20_000);

  // Ingredients: prefer the full <li> text through the shared parser (handles
  // amounts, units, and trailing notes); fall back to assembling the
  // amount/unit/name sub-spans when the full text fails to parse.
  const ingredients: RecipeDraft["ingredients"] = [];
  scope.find("li.wprm-recipe-ingredient").each((_, el) => {
    const $li = $(el);
    const fullText = sanitizeText($li.text());
    const parsed = fullText ? parseIngredientLine(fullText) : null;
    if (parsed) {
      ingredients.push(parsed);
      return;
    }
    const amount = sanitizeText($li.find(".wprm-recipe-ingredient-amount").first().text());
    const unit = sanitizeText($li.find(".wprm-recipe-ingredient-unit").first().text());
    const name = sanitizeText($li.find(".wprm-recipe-ingredient-name").first().text());
    const assembled = parseIngredientLine(`${amount} ${unit} ${name}`.trim());
    if (assembled) {
      const note = sanitizeText($li.find(".wprm-recipe-ingredient-notes").first().text());
      if (note && assembled.note === null) assembled.note = note.slice(0, 200);
      ingredients.push(assembled);
    }
  });
  draft.ingredients = ingredients.slice(0, 200);

  const steps: string[] = [];
  scope.find(".wprm-recipe-instruction-text").each((_, el) => {
    const text = sanitizeText($(el).text());
    if (text) steps.push(text);
  });
  draft.steps = steps.slice(0, 100);

  const servingsEl = scope.find(".wprm-recipe-servings").first();
  if (servingsEl.length > 0) {
    draft.servings = parseServings(servingsEl.text()) ?? parseServings(servingsEl.attr("datetime")) ?? null;
  }

  draft.prepMinutes = wprmMinutes($, scope, ".wprm-recipe-prep-time");
  draft.cookMinutes = wprmMinutes($, scope, ".wprm-recipe-cook-time");

  const course = sanitizeText(scope.find(".wprm-recipe-course").first().text());
  draft.category = course.slice(0, 60) || null;

  const tags: string[] = [];
  const keywords = sanitizeText(scope.find(".wprm-recipe-keywords").first().text());
  if (keywords) tags.push(...keywords.split(","));
  const cuisine = sanitizeText(scope.find(".wprm-recipe-cuisine").first().text());
  if (cuisine) tags.push(cuisine);
  draft.tags = tags
    .map((t) => sanitizeText(t))
    .filter(Boolean)
    .slice(0, 20);

  draft.sourceUrl = sourceUrl;
  return draft;
}

/* --------------------------------- entry ------------------------------------ */

/** Extract the best recipe draft from an HTML page. Returns null when none found. */
export function extractRecipeFromHtml(html: string, sourceUrl: string | null): ExtractedRecipe | null {
  const $ = cheerio.load(html);
  for (const node of findJsonLdRecipes($)) {
    const draft = jsonLdToDraft(node, sourceUrl);
    if (draft.title) return { draft, via: "json-ld" };
  }
  const microdata = microdataToDraft($, sourceUrl);
  if (microdata) return { draft: microdata, via: "microdata" };
  const rdfa = rdfaToDraft($, sourceUrl);
  if (rdfa) return { draft: rdfa, via: "rdfa" };
  const wprm = wprmToDraft($, sourceUrl);
  if (wprm) return { draft: wprm, via: "wprm" };
  return null;
}

