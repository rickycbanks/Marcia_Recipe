# Deployment

[← Back to Marcia Recipe](../README.md)

Marcia Recipe supports two deployment modes. **For a full step-by-step guide to deploying on
Oracle Cloud's Always Free tier, see [`ORACLE_CLOUD.md`](ORACLE_CLOUD.md).**

## Before you deploy

- **Node.js 22 LTS** or newer (required by Next.js 16, Sharp, Undici, and the test toolchain)
- A **persistent writable filesystem** for `DATA_ROOT`
- **One writable application instance** (no cluster mode, no multiple replicas against the same
  data directory)

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `NODE_ENV` | yes | `development` / `test` / `production` |
| `DATA_ROOT` | yes | Absolute path to the mutable data directory |
| `AUTH_SECRET` | prod | ≥32 random chars; signs session JWTs |
| `SETUP_TOKEN` | prod | One-time token for first-run owner setup |
| `APP_ORIGIN` | prod | Public origin, e.g. `https://recipes.example.com` |
| `MISTRAL_API_KEY` | optional | Legacy fallback for Mistral OCR when no private OCR config exists; not the primary setup path |
| `PRIVATE_CONFIG_KEYRING` | optional | Encryption key for cloud OCR credentials; required to save Mistral or Gemini credentials. Without it, only browser-local Tesseract OCR is available. See [`OCR-SETUP.md`](OCR-SETUP.md). |

Generate secrets with:

```sh
openssl rand -base64 48   # AUTH_SECRET
openssl rand -hex 16      # SETUP_TOKEN
```

## Option A — Docker (recommended)

Create a `.env` beside `docker-compose.yml`:

```dotenv
AUTH_SECRET=replace-with-at-least-32-random-characters
SETUP_TOKEN=replace-with-a-long-one-time-setup-token
APP_ORIGIN=https://recipes.example.com
```

Then:

```sh
docker compose up -d --build
docker compose logs -f app
```

The named `marcia_recipe_data` volume holds all accounts, recipes, media, and personal data.
Back it up regularly and keep a copy off the host.

Place a TLS reverse proxy (Caddy, Nginx) in front of port 3000. **Never expose the dev server
or port 3000 directly to the public internet.** A minimal Caddyfile is in
`deploy/Caddyfile.example`.

## Option B — Direct Node.js

```sh
npm ci
npm run build
NODE_ENV=production DATA_ROOT=/var/lib/marcia-recipe \
  AUTH_SECRET='...' SETUP_TOKEN='...' APP_ORIGIN='https://recipes.example.com' \
  npm start
```

A systemd unit example is at `deploy/marcia-recipe.service`:
- Copy it to `/etc/systemd/system/`
- Create a dedicated `marcia-recipe` user
- Create `/var/lib/marcia-recipe`
- Put secrets in `/etc/marcia-recipe/marcia-recipe.env` (mode `0600`)
- Use `deploy/Caddyfile.example` as a TLS reverse-proxy starting point

## Building from source

```sh
npm ci
npm run build
```

The production build uses Next.js `standalone` output, producing a self-contained
`.next/standalone/server.js` that runs without `next start`.

### Checks

```sh
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm test           # vitest run (unit tests)
npm run e2e         # playwright (browser smoke tests)
npm run build       # production build
```
