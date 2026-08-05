# Screenshots

This directory holds screenshots referenced by the root [`README.md`](../../README.md).

The screenshots are **not** generated automatically — they are captured from a running local
instance so they reflect real content and themes. Capture them once the app is running and
you have a few sample recipes and an owner account set up.

## Setup

```sh
npm ci
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`, complete first-run setup at `/setup`, create a few recipes
with images, invite one guest, and create a meal plan + shopping list so the screens have
realistic content.

## Capture list

Save each screenshot as a PNG at **1440×900** (or wider for tables) with the browser chrome
hidden. Light mode is fine; capture dark mode variants only if you want to add them.

| File | Route | Notes |
| --- | --- | --- |
| `recipe-list.png` | `/recipes` | Public recipe grid; include a mix of cards with images |
| `recipe-detail.png` | `/recipes/<slug>` | A recipe with ingredients, steps, notes, and a photo |
| `admin-dashboard.png` | `/admin` | Owner dashboard (logged in as owner) |
| `recipe-editor.png` | `/admin/recipes/new` | Editor with ingredients/steps/media sections visible |
| `meal-planner.png` | `/meal-planner` | A week with a few recipes dropped into slots |
| `shopping-list.png` | `/shopping-lists/<id>` | A list with some checked and unchecked items |
| `import-panel.png` | `/admin` (Import panel) | URL and OCR import panels side by side |
| `invitations.png` | `/admin/invitations` | At least one issued invitation row |
| `settings.png` | `/admin/settings` | Settings page with theme picker visible |

## Tips

- Use a browser extension or the OS screenshot tool to capture the viewport only (not the
  whole desktop).
- Crop to the viewport; keep a small consistent margin.
- Compress PNGs with `pngquant` or `oxipng` before committing to keep the repo small:
  ```sh
  pngquant --quality=70-90 --strip *.png
  ```
- Filenames must match the table in `README.md` exactly so the image links resolve.