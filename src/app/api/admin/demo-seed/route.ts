import { PassThrough, Readable } from "node:stream";
import { createGzip } from "node:zlib";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { jsonOk } from "@/lib/api";
import * as tar from "tar-stream";
import { apiHandler } from "@/lib/api";
import { requireOwner } from "@/lib/authorization/guards";
import { listAllAccounts } from "@/lib/accounts/service";
import { listRecipes, recipeMediaDir } from "@/lib/storage/repositories/recipes";
import { recipeToMarkdown } from "@/lib/export/markdown";
import { getDataRoot } from "@/lib/storage/dataRoot";
import { join, relative } from "node:path";
import { readdir, stat } from "node:fs/promises";
import type { Account } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fileTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

async function appendFile(pack: tar.Pack, root: string, absolutePath: string): Promise<void> {
  const name = relative(root, absolutePath);
  const info = await stat(absolutePath);
  await new Promise<void>((resolve, reject) => {
    const entry = pack.entry({ name, size: info.size }, (err) => (err ? reject(err) : resolve()));
    createReadStream(absolutePath)
      .on("error", reject)
      .pipe(entry);
  });
}

async function appendMedia(pack: tar.Pack, root: string, recipeId: string): Promise<void> {
  const dir = recipeMediaDir(recipeId);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".webp")) continue;
    await appendFile(pack, root, join(dir, entry));
  }
}

export const GET = apiHandler(async () => {
  await requireOwner();

  const now = new Date();
  const stamp = fileTimestamp(now);
  const rootName = `marcia-demo-seed-${stamp}`;
  const filename = `${rootName}.tar.gz`;
  const root = getDataRoot();

  const [recipes, accounts] = await Promise.all([listRecipes(), listAllAccounts()]);
  const owner = accounts.find((account) => account.type === "owner") ?? null;

  const pack = tar.pack();
  const gzip = createGzip({ level: 9 });

  for (const recipe of recipes) {
    const recipeDir = join(root, "recipes", recipe.id);
    const recipeJson = join(recipeDir, "recipe.json");
    await appendFile(pack, root, recipeJson);
    await appendMedia(pack, root, recipe.id);
    pack.entry({ name: `${rootName}/recipes/${recipe.slug}.md` }, recipeToMarkdown(recipe));
  }
  for (const account of accounts) {
    const accountPath = join(root, "accounts", `${account.id}.json`);
    await appendFile(pack, root, accountPath);
  }
  if (owner) {
    const siteConfig = join(root, "config", "site.json");
    await appendFile(pack, root, siteConfig);
  }
  pack.entry(
    { name: `${rootName}/README.md` },
    [
      "# Marcia Demo Seed",
      "",
      `Generated: ${now.toISOString()}`,
      `Recipes: ${recipes.length}`,
      `Accounts: ${accounts.length}`,
    ].join("\n"),
  );
  pack.finalize();

  const passthrough = new PassThrough();
  const stream = Readable.toWeb(passthrough) as ReadableStream;
  await pipeline(pack, gzip, passthrough).catch(() => undefined);

  return new Response(stream, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
});

export const POST = apiHandler(async () => {
  const owner = await requireOwner();
  return jsonOk({ exportUrl: "/api/admin/demo-seed", message: "Use GET to download the seed archive.", actorAccountId: owner.id });
});
