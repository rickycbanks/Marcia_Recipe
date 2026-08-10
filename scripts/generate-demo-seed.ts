#!/usr/bin/env tsx
/**
 * Export the current demo recipe catalog into a repository-managed seed directory.
 *
 * Usage:
 *   npm run cli:generate-demo-seed -- \
 *     --app-origin https://recipes-demo.inthesky.dev \
 *     --username demo \
 *     --password 'demo123456' \
 *     --output-dir scripts/demo-seed
 *
 * The command writes:
 *   scripts/demo-seed/README.md
 *   scripts/demo-seed/manifest.json
 *   scripts/demo-seed/<slug>.json
 *   scripts/demo-seed/<slug>.webp
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "./lib";

const { flags } = parseArgs(process.argv.slice(2));
const origin = flags["app-origin"] ?? "https://recipes-demo.inthesky.dev";
const username = flags["username"] ?? "demo";
const password = flags["password"] ?? "demo123456";
const outputDir = flags["output-dir"] ?? "scripts/demo-seed";

interface Session {
  cookies: string;
}

interface ManifestRecipe {
  title: string;
  slug: string;
  recipeJson: string;
  primaryMedia: string;
  sourceUrl: string;
}

interface Manifest {
  exportedAt: string;
  origin: string;
  recipes: ManifestRecipe[];
}

function parseCookies(setCookies: string[]): string {
  const cookies: string[] = [];
  for (const header of setCookies) {
    const [pair] = header.split(";");
    if (pair) cookies.push(pair);
  }
  return cookies.join("; ");
}

async function login(): Promise<Session> {
  const csrfRes = await fetch(new URL("/api/auth/csrf", origin));
  const csrf = ((await csrfRes.json()) as { csrfToken: string }).csrfToken;
  const cookies = parseCookies(csrfRes.headers.getSetCookie());

  const callbackRes = await fetch(new URL("/api/auth/callback/credentials", origin), {
    method: "POST",
    headers: { cookie: cookies, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken: csrf, username, password }).toString(),
    redirect: "manual",
  });

  const mergedCookies = parseCookies([...callbackRes.headers.getSetCookie(), ...cookies.split("; ").filter(Boolean)]);
  return { cookies: mergedCookies };
}

async function requireOwnerRecipeIds(session: Session): Promise<string[]> {
  const adminRes = await fetch(new URL("/admin/recipes", origin), { headers: { cookie: session.cookies } });
  if (!adminRes.ok) throw new Error(`/admin/recipes returned ${adminRes.status}`);
  const html = await adminRes.text();
  const matches = [...html.matchAll(/\/admin\/recipes\/([0-9a-f-]{36})\/edit/g)];
  const ids = Array.from(new Set(matches.map((match) => match[1])));
  if (ids.length === 0) throw new Error("Could not discover any recipe ids from the admin page");
  return ids;
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  const session = await login();
  const ids = await requireOwnerRecipeIds(session);
  const recipes: ManifestRecipe[] = [];

  for (const id of ids) {
    const recipeRes = await fetch(new URL(`/api/admin/demo-seed/${id}`, origin), {
      headers: { cookie: session.cookies },
    });
    if (!recipeRes.ok) throw new Error(`/api/admin/demo-seed/${id} returned ${recipeRes.status}`);
    const recipe = (await recipeRes.json()) as { slug: string; title: string; media: { id: string; isPrimary: boolean }[] };
    const recipeFile = `${recipe.slug}.json`;
    const media = recipe.media.find((item) => item.isPrimary) ?? recipe.media[0];
    const primaryMedia = media ? `${recipe.slug}.webp` : "";

    await writeFile(join(outputDir, recipeFile), JSON.stringify(recipe, null, 2));
    if (media) {
      const mediaRes = await fetch(new URL(`/api/media/${id}/${media.id}`, origin), {
        headers: { cookie: session.cookies },
      });
      if (!mediaRes.ok) throw new Error(`/api/media/${id}/${media.id} returned ${mediaRes.status}`);
      const buffer = Buffer.from(await mediaRes.arrayBuffer());
      await writeFile(join(outputDir, primaryMedia), buffer);
    }

    recipes.push({
      title: recipe.title,
      slug: recipe.slug,
      recipeJson: recipeFile,
      primaryMedia,
      sourceUrl: `/api/admin/demo-seed/${id}`,
    });
  }

  const manifest: Manifest = {
    exportedAt: new Date().toISOString(),
    origin,
    recipes,
  };

  await writeFile(join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  await writeFile(
    join(outputDir, "README.md"),
    [
      "# Demo seed assets",
      "",
      `Exported from ${origin} at ${manifest.exportedAt}.`,
      "",
      "Files",
      "",
      ...recipes.map((entry) => `- \`${entry.slug}\`: \`${entry.recipeJson}\` + \`${entry.primaryMedia}\``),
    ].join("\n"),
  );

  console.log(`Wrote ${recipes.length} recipes to ${outputDir}`);
}

await main();
