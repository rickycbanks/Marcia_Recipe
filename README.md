![Marcia Recipe — Your recipes. Your week. Your kitchen.](docs/screenshots/cover.png)

# Marcia Recipe

A self-hosted recipe collection, weekly meal planner, and shopping list for your household.
One owner, invited guests, and **no database required** — everything is stored as plain files
you can back up by copying a single directory.

**Try the live demo:** https://recipes-demo.inthesky.dev — sign in with `demo` / `demo123456`
(reset to a seeded state every hour).

---

## A look inside

| | |
| --- | --- |
| ![Recipe list](docs/screenshots/recipe-list.png) | ![Recipe detail](docs/screenshots/recipe-detail.png) |
| ![Meal planner](docs/screenshots/meal-planner.png) | ![Shopping list](docs/screenshots/shopping-list.png) |
| ![Recipe editor](docs/screenshots/recipe-editor.png) | ![Settings & themes](docs/screenshots/settings.png) |

More screenshots — including the import panel, invitations manager, and mobile views — are in
[`docs/screenshots/`](docs/screenshots).

---

## Features

- **Recipes** — create, edit, and archive recipes with ingredients, steps, Markdown notes, tags,
  photos, and per-recipe visibility (public, members-only, or owner-only)
- **Import** — paste a recipe URL or upload a photo and get a ready-to-review draft; nothing is
  saved until you approve it
- **Meal planner** — drag recipes into a weekly grid, then generate a shopping list from your plan
- **Shopping lists** — check items off, add manual items, and export; saved lists are snapshots,
  so editing a recipe never silently changes them
- **Accounts & invitations** — invite guests with individually assigned capabilities
  (read recipes, use meal plans, use shopping lists) that you can revoke at any time
- **Search & themes** — fuzzy search over everything you can see, four visual themes with
  light/dark modes, and an installable PWA for your phone or tablet
- **Self-hosted & private** — flat-file storage, atomic writes, and built-in backup/restore tooling

---

## Run it locally

**Requirements:** Node.js 22 LTS or newer.

```sh
npm ci
cp .env.example .env   # then edit values
npm run dev
```

Open `http://localhost:3000`, then visit `/setup` once and enter your `SETUP_TOKEN` to create
the owner account. Web setup is disabled after the first owner exists.

Generate secrets with:

```sh
openssl rand -base64 48   # AUTH_SECRET
openssl rand -hex 16      # SETUP_TOKEN
```

---

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Docker and direct Node.js deployment, environment variables, building from source |
| [`docs/ORACLE_CLOUD.md`](docs/ORACLE_CLOUD.md) | Step-by-step Oracle Cloud Always Free deployment |
| [`docs/USAGE.md`](docs/USAGE.md) | First run, adding recipes, inviting guests, meal planning, backups |
| [`docs/OCR-SETUP.md`](docs/OCR-SETUP.md) | Cloud OCR providers (Tesseract, Mistral, Gemini) and keyring setup |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Security and privacy design notes |
| [`docs/BRANCHES.md`](docs/BRANCHES.md) | Branch system and the public demo instance |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How the app is built, what each part is, and why |
| [`docs/screenshots/`](docs/screenshots) | Screenshot gallery and capture instructions |
| [`scripts/demo-seed/README.md`](scripts/demo-seed/README.md) | Immutable demo seed + regenerating/restoring instructions (this branch only) |
| [`scripts/generate-demo-seed.ts`](scripts/generate-demo-seed.ts) | Export the live demo catalog into a repo-managed seed directory |
| [`scripts/restore-demo-seed.ts`](scripts/restore-demo-seed.ts) | Rebuild a DATA_ROOT from the repo-managed seed directory (atomic, id-keyed associations) |
| [`scripts/validate-demo-seed.ts`](scripts/validate-demo-seed.ts) | Verify recipe ↔ media id ↔ sha256 integrity of a seed directory |

---

## License

UNLICENSED — private, self-hosted software.
