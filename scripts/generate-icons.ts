#!/usr/bin/env tsx
/**
 * Generate the PWA PNG icons (public/icons/) from the app's SVG mark.
 * Usage: npm run icons
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const root = process.cwd();
const svg = await readFile(join(root, "src/app/icon.svg"));
const outDir = join(root, "public", "icons");
await mkdir(outDir, { recursive: true });

const targets = [
  { name: "icon-192.png", size: 192, padding: 0 },
  { name: "icon-512.png", size: 512, padding: 0 },
  // Maskable: safe-zone padding so launchers can crop to any shape.
  { name: "icon-maskable-512.png", size: 512, padding: 64 },
];

for (const target of targets) {
  const inner = target.size - target.padding * 2;
  const png = await sharp(svg, { density: 384 })
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({
      top: target.padding,
      bottom: target.padding,
      left: target.padding,
      right: target.padding,
      background: target.padding > 0 ? { r: 140, g: 74, b: 47, alpha: 1 } : { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  await writeFile(join(outDir, target.name), png);
  console.log(`wrote public/icons/${target.name}`);
}
