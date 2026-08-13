# Demo seed assets

This directory is the **immutable canonical source** for the public demo at
https://recipes-demo.inthesky.dev. It is committed to the repository and
restored into the demo `DATA_ROOT` on every reset (hourly and after every
`for_demo` deploy). Public-writable user changes are wiped on each reset.

> This seed was authored directly from researched Pexels source photos (see
> [`SOURCES.md`](./SOURCES.md)). **A human must still visually confirm every
> recipe's primary image matches its title** before this seed is trusted in
> production — imagery was selected from source metadata, not by visual
> inspection.

## Layout

```
scripts/demo-seed/
  manifest.json            ← repo-managed seed manifest (sha256 + media ids)
  SOURCES.md               ← Pexels source mapping + provenance for every image
  README.md                ← this file + the recipe table
  config/
    site.json
  accounts/
    <accountId>.json
  recipes/
    <recipeId>/
      recipe.json
      media/
        <mediaId>.webp
```

Media files are named after their own `media.id` (per `mediaItemSchema`), not
slug nor array position. The restore path uses each `recipe.media[i].id` to
name the destination file, so array ordering cannot silently swap image bytes
between recipes.

## Recipes

| Recipe | Category | Visibility | Primary media id | Media files |
| --- | --- | --- | --- | --- |
| Blueberry Buttermilk Pancakes | Breakfast | public | 00000000-0000-4000-8000-000000000100 | 2 |
| Avocado, Egg & Chili Toast | Breakfast | inherit | 00000000-0000-4000-8000-000000000102 | 1 |
| Lemony Chickpea Crunch Salad | Lunch | members | 00000000-0000-4000-8000-000000000103 | 1 |
| Roast Chicken Pesto Ciabatta | Lunch | public | 00000000-0000-4000-8000-000000000104 | 1 |
| Sheet-Pan Lemon Herb Salmon & Vegetables | Dinner | public | 00000000-0000-4000-8000-000000000105 | 2 |
| Creamy Mushroom Rigatoni | Dinner | public | 00000000-0000-4000-8000-000000000107 | 1 |
| Dark Chocolate Raspberry Tart | Dessert | owner | 00000000-0000-4000-8000-000000000108 | 2 |
| Honey Vanilla Panna Cotta with Berries | Dessert | public | 00000000-0000-4000-8000-00000000010a | 1 |

## Accounts

- `demo` (owner, id `00000000-0000-4000-8000-000000000001`) — password `demo123456`

## Validating

```sh
npm run cli:validate-demo-seed -- --output-dir scripts/demo-seed
```

## Regenerating from a live instance

The seed can also be exported from a known-good Marcia instance:

```sh
npm run cli:generate-demo-seed -- \
  --app-origin https://recipes-demo.inthesky.dev \
  --username demo --password 'demo123456' \
  --output-dir scripts/demo-seed
```
