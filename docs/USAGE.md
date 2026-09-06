# Using Marcia Recipe

[← Back to Marcia Recipe](../README.md)

## First run

1. Start the app and visit `/setup`
2. Enter your `SETUP_TOKEN` to create the owner account
3. Log in and configure site settings (default visibility, theme) at `/admin/settings`

> The local CLI can create the owner without a web setup token:
> ```sh
> npm run cli:create-owner
> npm run cli:reset-password -- --username owner
> ```

## Adding recipes

- **Manual**: `/admin/recipes/new` — fill in title, ingredients, steps, notes, media, visibility
- **URL import**: `/admin` → Import panel → paste a recipe URL → review the draft → save
- **OCR import**: `/admin` → Import panel → upload an image → review the extracted draft → save
- Imports and OCR **never** save directly — you always review a draft first

## Inviting guests

1. `/admin/invitations` → New invitation
2. Choose capabilities (Read recipes / Use meal plans / Use shopping lists)
3. Set an expiry
4. Send the one-time invitation link — the secret is shown **only once**
5. The guest follows the link, creates an account, and lands with the assigned capabilities

## Meal planning & shopping lists

- `/meal-planner` — drag recipes into a weekly grid (requires `mealPlans.use`)
- Generate a shopping list from a plan (requires `shoppingLists.use`)
- `/shopping-lists` — check items off, add manual items, export

## Backups & maintenance

```sh
npm run cli:backup -- --data-root /var/lib/marcia-recipe
npm run cli:restore -- --file backups/marcia-backup-...tar.gz --dry-run
npm run cli:restore -- --file backups/marcia-backup-...tar.gz --force
npm run cli:migrate -- --data-root /var/lib/marcia-recipe
npm run cli:rebuild-indexes -- --data-root /var/lib/marcia-recipe
```

Always back up before migration or restore. Encrypted OCR configuration (`config/ocr.private.json`)
is included in backups, but backup recovery requires retaining the matching `PRIVATE_CONFIG_KEYRING`
— key loss makes stored cloud credentials unrecoverable. Restore validation runs before any canonical
files are replaced; `--force` is required to replace an existing data root.
