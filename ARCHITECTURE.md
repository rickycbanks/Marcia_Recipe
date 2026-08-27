# Architecture

This document explains how Marcia Recipe is built, what each part does, and why the pieces
were chosen. It is intended for maintainers and anyone evaluating whether to fork or extend
the project.

> **Design constraint that shapes everything:** one owner, one writable instance, one
> persistent filesystem directory. No database, no clustering, no serverless. This is a
> single-household tool, not a multi-tenant SaaS.

---

## 1. Technology stack

| Layer | Choice | Why |
| --- | --- | --- |
| Runtime | **Node.js 22 LTS** | Required by Next.js 16, Sharp, Undici, and the test toolchain. LTS for stability. |
| Framework | **Next.js 16** (App Router) | Server components, route handlers, and standalone output in one framework. App Router gives filesystem-based routing with nested layouts. |
| Language | **TypeScript** (strict) | Catches persistence and authorization bugs at compile time. Strict mode is non-negotiable for a security-sensitive app. |
| Styling | **Tailwind CSS 4** | Utility-first, no runtime CSS-in-JS, small production bundles. Typography plugin for recipe notes. |
| Auth | **Auth.js / next-auth v5** | Credentials provider with JWT sessions and **no adapter** — there is no database to adapt to. |
| Validation | **Zod 4** | Every persisted and submitted document is validated. Schemas are the single source of truth for shapes. |
| Image processing | **Sharp** | Fast native image decode, resize, and WebP conversion. Server-external package so it stays out of the bundle. |
| Search | **Fuse.js** | Browser-side fuzzy search over a per-request index. No search server needed at this scale. |
| OCR | **Tesseract.js** (browser) + **Mistral**, **Gemini** (server) | Tesseract runs client-side with no API key; Mistral and Gemini are server-side two-pass pipelines (OCR → structured extraction), configured via encrypted private config (`config/ocr.private.json`). Admin selects the site-wide provider; users cannot override. |
| PWA | **Serwist** | Modern service-worker toolkit for Next.js. Precaches only the static shell. |
| Locking | **proper-lockfile** | Cross-process filesystem locks — essential because backups must block writes briefly. |
| Tests | **Vitest** (unit) + **Playwright** (e2e) | Vitest for storage/auth logic; Playwright for browser smoke tests. |
| Package manager | **npm** (with `package-lock.json`) | Ubiquitous; the Dockerfile uses `npm ci` for reproducible installs. `bun.lock` is present for local dev convenience. |

---

## 2. Repository layout

```
Marcia_Recipe/
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── (public)/             # Anonymous + reader routes
│   │   ├── (authenticated)/     # Personal routes (planner, shopping, account)
│   │   ├── admin/                # Owner-only routes
│   │   ├── api/                  # Route handlers (auth, import, media, backups, export)
│   │   ├── setup/                # First-run owner setup
│   │   ├── layout.tsx            # Root layout, theme provider, headers
│   │   ├── manifest.ts           # PWA web manifest
│   │   └── sw.ts                 # Service worker source (built to public/sw.js)
│   ├── components/               # React components (UI + admin panels)
│   │   ├── admin/                # Recipe editor, accounts, invitations, backups, import, media
│   │   ├── forms/                # Shared form primitives
│   │   ├── meal-planner/         # Weekly planner
│   │   └── shopping/            # Shopping list view
│   ├── lib/                      # Server-side domain logic (no React)
│   │   ├── auth/                 # Session, passwords, rate limit, setup tokens
│   │   ├── authorization/        # Guards, capabilities, visibility, origin
│   │   ├── storage/              # Flat-file engine: atomic writes, locks, repos, migrations
│   │   ├── recipes/              # Recipe service (CRUD, visibility, indexing)
│   │   ├── meal-plans/           # Per-account weekly plans
│   │   ├── shopping-lists/       # Per-account lists + generation
│   │   ├── invitations/          # Issue, accept, cancel
│   │   ├── imports/              # URL fetch, HTML parse, OCR, text heuristics
│   │   ├── media/                # Upload validation, Sharp processing, serving
│   │   ├── backups/              # Backup + restore service
│   │   ├── export/               # Markdown export
│   │   ├── audit/                # Bounded audit log
│   │   ├── env.ts                # Zod-validated environment
│   │   ├── errors.ts             # Typed AppError hierarchy
│   │   ├── logger.ts             # Structured logger
│   │   ├── startup.ts            # Eager validation + integrity checks
│   │   └── ids.ts                # UUID generation
│   ├── types/                    # Shared TypeScript types
│   └── instrumentation.ts       # Next.js instrumentation hook (startup checks)
├── scripts/                      # CLI entry points (create-owner, backup, restore, migrate, ...)
├── tests/                        # Vitest unit tests + Playwright e2e
├── public/                       # Static assets + generated icons + built sw.js
├── deploy/                       # systemd unit + Caddyfile example
├── Dockerfile                    # Multi-stage non-root image
├── docker-compose.yml            # Single-instance compose with named volume
├── next.config.ts                # Standalone output, security headers, Serwist
└── package.json
```

---

## 3. Data model and persistence

### 3.1 Why flat-file?

The product is explicitly scoped to **one owner, fewer than 2,000 recipes, fewer than 25
accounts, low traffic**. A database server is operational overhead with no payoff at this
scale. A filesystem directory is:

- **Trivially backed up** — `tar` the directory
- **Trivially inspected** — `cat` any file
- **Trivially restored** — extract an archive
- **Zero-dependency** — no DB process to run, upgrade, or lose

The tradeoff: **one writable instance only**. There is no replication, no cluster mode, and
no multi-writer design. This is an accepted non-goal.

### 3.2 `DATA_ROOT` layout

All mutable state lives under one configurable directory:

```
DATA_ROOT/
├── config/
│   ├── site.json                 # Site settings (default visibility, theme)
│   └── ocr.private.json          # Encrypted OCR provider config (AES-256-GCM envelope)
├── accounts/
│   └── <account-id>.json          # One file per account
├── invitations/
│   └── <invitation-id>.json       # One file per invitation (secret hashed)
├── recipes/
│   └── <recipe-id>/
│       ├── recipe.json            # Canonical recipe document
│       └── media/                 # Recipe images (WebP)
├── users/
│   └── <account-id>/
│       ├── meal-plans/            # Per-account weekly plans
│       └── shopping-lists/        # Per-account saved lists (snapshots)
├── indexes/                       # Derived, disposable (search, thumbnails)
├── audit/                         # Bounded audit log
├── backups/                       # Generated backup archives
├── locks/                         # Cross-process lock files
└── tmp/                           # Scratch space
```

Locks live in a **sibling** directory (`${DATA_ROOT}.locks/`) so a `DATA_ROOT` rename during
restore cannot strand a lock.

### 3.3 Atomic writes

Every canonical write goes through `writeJsonAtomic` / `writeBufferAtomic`
(`src/lib/storage/atomic.ts`):

1. Write to a temp file in the **same directory** (same filesystem → rename is atomic)
2. `fsync` the temp file
3. `rename` over the target

A crash leaves either the old file or the new file — **never a torn write**. Temp files are
cleaned up on error.

### 3.4 Cross-process locking

`src/lib/storage/lock.ts` wraps `proper-lockfile` with three named locks:

| Lock | Purpose |
| --- | --- |
| `writes` | Serializes all canonical mutations. Simple, deadlock-free, fine at this scale. |
| `backup` | Held by the backup CLI to freeze writes briefly for a consistent snapshot. |
| `root-swap` | Held during restore to swap the entire `DATA_ROOT` atomically. |

Locks are reentrant within a request via `AsyncLocalStorage`, so a service that already holds
the `writes` lock can call another mutation without deadlocking.

### 3.5 Schema validation and quarantine

- Every loaded document is parsed and validated with its Zod schema (`readJson`)
- Malformed documents are either quarantined (moved aside) or throw `storageCorrupt`
- Unsupported schema versions are **rejected without modifying files**
- Derived indexes are disposable — `cli:rebuild-indexes` regenerates them from canonical files

### 3.6 Migrations

`src/lib/storage/migrations.ts` + `npm run cli:migrate` apply version-aware schema migrations.
A backup is required before migration. Migrations are idempotent and repeatable.

---

## 4. Authentication and authorization

### 4.1 Authentication

- **Auth.js v5** Credentials provider, **JWT strategy**, **no database adapter**
- Passwords hashed with Node `crypto.scrypt` (`src/lib/auth/passwords.ts`)
- JWTs carry **only** the account ID (`sub`) and `sessionVersion` (`sv`) — never capabilities
- Login rate-limited by normalized username **and** client address (`src/lib/auth/rateLimit.ts`)
- Secure, HTTP-only, SameSite cookies; `secure` auto-enabled for HTTPS origins
- Owner password reset via local CLI (`npm run cli:reset-password`) — no email dependency

### 4.2 Authorization (the important part)

The JWT is **only a hint**. Every protected operation reloads the account file and re-checks
(`src/lib/authorization/guards.ts`):

```
getSessionAccount() → auth() → getAccount(id) → check disabledAt → check sessionVersion
```

This means:
- **Disabling an account** takes effect on the next request — no JWT expiry wait
- **Changing capabilities** takes effect immediately
- **Rotating a password** (which bumps `sessionVersion`) invalidates all existing sessions

Guards: `requireSession`, `requireOwner`, `requireCapability`, plus `canViewRecipe` for
visibility. Every mutation service calls these directly — **not** just pages or middleware.

### 4.3 Capabilities

| Capability | Who | Depends on |
| --- | --- | --- |
| `recipes.read` | guests | — |
| `mealPlans.use` | guests | `recipes.read` |
| `shoppingLists.use` | guests | `recipes.read` |
| `recipes.manage` | owner | — |
| `recipes.import` | owner | — |
| `media.manage` | owner | — |
| `accounts.manage` | owner | — |
| `site.manage` | owner | — |
| `backups.manage` | owner | — |

Dependencies are enforced in both the admin UI and server services.

### 4.4 Recipe visibility

`src/lib/authorization/visibility.ts` is the single source of truth:

- **Owner** sees everything
- `owner` recipes → owner only
- `members` recipes → any enabled account with `recipes.read`
- `public` recipes → everyone, including anonymous
- `inherit` → resolves against the site default (`public` or `members`)

Authorization is applied **before** returning recipe metadata, content, media, search
entries, or source URLs.

---

## 5. Next.js routing and caching

### 5.1 Route groups

| Group | Routes | Access |
| --- | --- | --- |
| `(public)` | `/`, `/recipes`, `/recipes/[slug]`, `/login`, `/invite/[id]/[secret]`, `/offline` | Anonymous + readers |
| `(authenticated)` | `/meal-planner`, `/shopping-lists`, `/shopping-lists/[id]`, `/account` | Any enabled account |
| `admin` | `/admin`, `/admin/recipes`, `/admin/accounts`, `/admin/invitations`, `/admin/settings`, `/admin/backups`, `/admin/exports` | Owner only |
| `api` | Auth handlers, search, media, import, OCR, backups, export | Per-route guards |

### 5.2 Caching and privacy

- Every filesystem-touching route uses the **Node.js runtime** (not Edge)
- Access-controlled pages and handlers render **dynamically** — no static generation of member/owner content
- Authenticated/protected responses send `private, no-cache, no-store`
- Recipe media and indexes are **never** placed in `public/` — they are served through
  authorized route handlers
- The service worker precaches **only** the static shell and offline fallback — never recipe
  content, API responses, or media
- ETags are used for public data where useful, but revalidation is always required

---

## 6. Recipe import and OCR

`src/lib/imports/` handles URL and OCR imports. Imports are **owner-only** and **never persist
directly** — they return a draft for owner review.

### 6.1 URL import

Strategies tried in order (`service.ts`):

1. **Direct** fetch + HTML parse (JSON-LD → Microdata → RDFa)
2. **Print-view** (`?print=1`) fetch + parse
3. **Wayback Machine** — fetch the newest archive snapshot
4. **Jina reader** (`r.jina.ai`) — render to markdown, parse with text heuristics

All fetches go through `ssrfSafeFetch` (`fetch.ts`), which validates:
- Protocol (http/https only)
- Ports (no loopback, private, link-local, metadata endpoints)
- DNS resolution
- Redirects (re-validated against SSRF rules)
- Response size and content type
- Timeouts

### 6.2 OCR

The site-wide OCR provider is selected by the owner in Admin Settings (`/admin/settings`) and
stored in encrypted form at `config/ocr.private.json`. The selection flow:

1. **Private config exists** → use its `activeProvider` value.
2. **No private config** + legacy `MISTRAL_API_KEY` env var → Mistral (backward compatibility).
3. **Neither** → Tesseract (browser-side default).

| Provider | Execution | Pipeline |
| --- | --- | --- |
| **Tesseract** | Browser-side (Tesseract.js) | Single-pass: image → text (no API key, no server round-trip). Always available. |
| **Mistral** | Server-side two-pass | Pass 1: `mistral-ocr-latest` OCR endpoint → markdown. Pass 2: `ministral-3b-2512` Chat Completions with strict JSON Schema → structured recipe JSON. |
| **Gemini** | Server-side two-pass | Pass 1: `gemini-3.5-flash-lite` vision/text → transcription markdown. Pass 2: same model → structured recipe JSON via the Google Generative Language REST API. |

Cloud providers perform two sequential passes: first OCR the image to text, then extract structured
recipe data (title, description, times, servings, ingredients with quantities/units, steps, notes).
The structured result is converted to a `RecipeDraft` using the fraction-aware parser and validated
with `recipeDraftSchema` before returning. If pass 2 fails or produces invalid output, the heuristic
parser (`ocr.ts`) runs on pass-1 text as a fallback — surfaced to the caller as a status notice,
not silently represented as AI-normalized.

Users **cannot** choose or override the provider at import time — the admin-selected provider is
used for all server-side OCR calls. Tesseract always runs in the browser; cloud providers run
server-side. There is **no silent fallback** between providers — if a cloud provider is selected but
misconfigured, the call fails with an actionable error. Tesseract never sends data to a second pass.

Legacy providers (Veryfi, Google Document AI) are read compatibly and resolved to Tesseract until
the owner saves a new selection. On save, only canonical provider fields are written.

Cloud provider credentials are stored in the encrypted private config. Without `PRIVATE_CONFIG_KEYRING`
the module cannot read or write encrypted config, and only browser-local Tesseract is available. When
no private config exists and `MISTRAL_API_KEY` is set, Mistral is used as a legacy fallback (env key
only, not encrypted).

The extraction prompt and JSON schemas are fixed server-side. The prompt instructs the model to
extract only source-supported information, preserve ingredients/steps, use null for unknown values,
and return no prose outside structured output. No prompts, API keys, raw OCR text, or provider
response bodies are logged.

### 6.3 Encrypted private configuration

Cloud OCR credentials are stored in `DATA_ROOT/config/ocr.private.json` as an **AES-256-GCM
encrypted envelope** — plaintext is never written to disk.

**Envelope format** (`v1`): `v1.<base64url-iv>.<base64url-ciphertext>.<base64url-tag>`

- 12-byte random IV (initialization vector)
- 16-byte authentication tag (GCM)
- AAD (additional authenticated data) is the literal version string `v1`

The `PRIVATE_CONFIG_KEYRING` environment variable holds one or more comma-separated
`keyId:base64url(32-byte-key)` pairs. The **first** key encrypts; **all** keys decrypt.
This supports key rotation: `--rotate` prepends a new key while retaining old entries, so
existing encrypted data can still be decrypted with the previous key.

`AUTH_SECRET` is **never** used for private config encryption — it is a separate secret used
only for JWT signing.

**Admin API**: The GET `/api/admin/ocr-settings` endpoint returns a sanitized view — configured
provider booleans and keyring availability status. Secrets (API keys) are **never** exposed.
The PATCH endpoint writes the encrypted envelope atomically (temp file → rename). Legacy provider
fields (Google Document AI, Veryfi) are silently discarded on save.

**Key rotation**: First encrypts with the new key; all existing keys remain for decryption.
Rotating is: (1) run `cli:setup-private-config-keyring --rotate` to prepend a new key to the
env var, (2) the next save re-encrypts with the new key. Old keys remain until explicitly removed.

---

## 7. Meal planning and shopping lists

- **Per-account** — no shared household plans in v1 (a deferred enhancement)
- Meal plans reference recipes by **immutable ID**, so slug renames never break references
- Shopping lists generated from plans are **snapshots** — recipe edits do not silently alter
  a saved list
- Archived recipes appear as **tombstones** in historical plans (not silently removed)
- Capability-gated: `mealPlans.use` and `shoppingLists.use` (both require `recipes.read`)

---

## 8. Backups and restore

- `npm run cli:backup` takes the `backup` lock (freezing writes briefly) and produces a
  versioned `.tar.gz` of all canonical data (config, accounts, invitations, recipes, personal
  data, media). Indexes, locks, and tmp are excluded.
- Encrypted OCR configuration (`config/ocr.private.json`) is included in backups as an opaque
  envelope. Restore validation checks the envelope shape (version, IV, ciphertext, tag
  structure) without attempting decryption — actual decryption is governed by the keyring at
  runtime. **Backup recovery requires the matching `PRIVATE_CONFIG_KEYRING`** — key loss makes
  stored cloud credentials unrecoverable.
- `npm run cli:restore` validates an archive **before** touching live data, supports
  `--dry-run`, and requires `--force` to replace an existing data root.
- Web restore is gated behind a stable root-swap barrier (see `cleanup.md` for the release
  contract) — it is not enabled until the full barrier is wired through startup recovery,
  audit logging, and self-healing indexes.

---

## 9. PWA and offline

- `next.config.ts` wires **Serwist** with `swSrc: src/app/sw.ts` → `swDest: public/sw.js`
- The service worker precaches the static shell only
- `reloadOnOnline: true` reloads when connectivity returns
- A static `/offline` page is the fallback
- **Protected recipe content, media, and API responses are never runtime-cached** — this is
  enforced in `sw.ts` and covered by automated cache-inspection tests

---

## 10. Deployment

Two supported modes, both producing a single writable instance:

### Docker (recommended)
- Multi-stage `Dockerfile`: dependencies → builder → non-root runner
- `output: "standalone"` in `next.config.ts` produces a self-contained `server.js`
- `docker-compose.yml` mounts a named volume at `DATA_ROOT` and adds a healthcheck
- Place Caddy/Nginx in front for TLS

### Direct Node.js
- `npm ci` → `npm run build` → `npm start` with env vars
- `deploy/marcia-recipe.service` is a hardened systemd unit (NoNewPrivileges,
  ProtectSystem=strict, ReadWritePaths scoped to `DATA_ROOT`)
- `deploy/Caddyfile.example` is a minimal TLS reverse proxy

See [`oracle_cloud.md`](oracle_cloud.md) for a full Oracle Cloud Always Free walkthrough.

---

## 11. Testing

| Suite | Tool | Scope |
| --- | --- | --- |
| Unit | Vitest | Storage CRUD, atomic writes, lock contention, path traversal, schema validation, auth matrix, visibility, import parsing, OCR, search index, settings, backup/restore |
| E2E | Playwright (Chromium) | Browser smoke tests against a running instance |

Run all checks:

```sh
npm run typecheck && npm run lint && npm test && npm run e2e && npm run build
```

---

## 12. Key design principles

1. **One writable instance.** No clustering, no multi-writer, no serverless. Accepted non-goal.
2. **The filesystem is the database.** Atomic writes, cross-process locks, schema validation.
3. **The JWT is only a hint.** Capabilities reload on every protected request — revocation is immediate.
4. **Imports never persist.** Drafts only — the owner reviews and submits.
5. **Derived data is disposable.** Indexes and thumbnails rebuild from canonical files.
6. **Private data never enters `public/` or the service worker cache.**
7. **Secrets stay outside the image and repo.** `.env` is gitignored; `DATA_ROOT` is outside the app tree.
8. **Fail fast on misconfiguration.** `instrumentation.ts` validates env and `DATA_ROOT` at startup.

---

## 13. Deferred enhancements (non-goals for v1)

- Shared household meal plans and shopping lists
- Guest recipe contributions with owner approval
- Encrypted offline access to restricted recipes
- Multiple writers or clustered deployment
- External object-storage adapter
- Git-based revision history
- Recipe revisions and rollback UI
- Multi-language content
- API keys or third-party integrations