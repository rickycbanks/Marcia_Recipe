# Marcia Recipe

Marcia Recipe is a self-hosted recipe binder for one owner and invited guests.
It uses Next.js and a filesystem-backed JSON store instead of a database.

## Features

- Recipe creation, editing, archiving, media uploads, tags, categories, and visibility controls
- Public, members-only, and owner-only recipes
- Owner-issued invitations with individually assigned guest capabilities
- Private per-account meal plans and shopping lists
- URL recipe import with JSON-LD, Microdata, RDFa, print-view, Wayback, and Jina fallbacks
- Browser-side OCR with owner review before saving
- Four visual themes, dark/light mode, fuzzy search, and an installable PWA shell
- Atomic writes, cross-process locks, schema validation, migrations, backups, and restore validation

## Requirements

- Node.js 22 LTS or newer
- A persistent writable filesystem
- One writable application instance

Runtime data is stored beneath `DATA_ROOT` and is not part of the application build. Do not run multiple
writable replicas against the same directory unless a shared-filesystem locking design has been verified.

## Local development

```sh
npm ci
cp .env.example .env # create this file with the values below
npm run dev
```

Required production environment variables:

```dotenv
NODE_ENV=production
DATA_ROOT=/var/lib/marcia-recipe
AUTH_SECRET=replace-with-at-least-32-random-characters
SETUP_TOKEN=replace-with-a-long-one-time-setup-token
APP_ORIGIN=https://recipes.example.com
```

Generate secrets with:

```sh
openssl rand -base64 48
```

Open `/setup` once after starting the app and enter `SETUP_TOKEN` to create the owner account. Web setup is
disabled after the first owner is created. The local CLI can create the owner without a web setup token:

```sh
npm run cli:create-owner
npm run cli:reset-password -- --username owner
```

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

The project requires Node 22 because of Next.js, Sharp, Undici, and the current testing toolchain.

## Docker deployment

Create a `.env` file beside `docker-compose.yml`:

```dotenv
AUTH_SECRET=replace-with-at-least-32-random-characters
SETUP_TOKEN=replace-with-a-long-one-time-setup-token
APP_ORIGIN=https://recipes.example.com
```

Then start the single application instance:

```sh
docker compose up -d --build
docker compose logs -f app
```

The named `marcia_recipe_data` volume contains all accounts, recipes, media, and personal data. Back it up
regularly and keep a copy off the host:

```sh
npm run cli:backup
```

For production, place Caddy, Nginx, or another TLS reverse proxy in front of port 3000. Do not expose the
development server directly to the public internet.

## Direct Node deployment

The application can also run without Docker:

```sh
npm ci
npm run build
NODE_ENV=production DATA_ROOT=/var/lib/marcia-recipe \
  AUTH_SECRET='...' SETUP_TOKEN='...' APP_ORIGIN='https://recipes.example.com' \
  npm start
```

`deploy/marcia-recipe.service` is a systemd example. Copy it to `/etc/systemd/system/`, create a dedicated
`marcia-recipe` user, create `/var/lib/marcia-recipe`, and put secrets in
`/etc/marcia-recipe/marcia-recipe.env` with mode `0600`. Use `deploy/Caddyfile.example` as a minimal TLS
reverse-proxy starting point.

## CLI operations

```sh
npm run cli:backup -- --data-root /var/lib/marcia-recipe
npm run cli:restore -- --file backups/marcia-backup-...tar.gz --dry-run
npm run cli:restore -- --file backups/marcia-backup-...tar.gz --force
npm run cli:migrate -- --data-root /var/lib/marcia-recipe
npm run cli:rebuild-indexes -- --data-root /var/lib/marcia-recipe
```

Always create a backup before migration or restore. Restore validation happens before any canonical files are
replaced; `--force` is required to replace an existing data root.

## Security and privacy notes

- Guest capabilities are loaded from their account file on every protected request, so revocation is immediate.
- JWTs contain only the account ID and session version; they are not the authorization source of truth.
- Private recipe pages, search entries, media, API responses, and personal data are not service-worker cached.
- URL import validates protocol, ports, DNS results, redirects, response size, content type, and timeouts.
- Recipe imports and OCR produce drafts; nothing is saved until the owner reviews and submits the recipe form.
- Keep `DATA_ROOT` outside the repository and never commit `.env` or backup archives.
