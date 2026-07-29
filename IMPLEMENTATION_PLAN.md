# Marcia Recipe — Implementation Plan

## Implementation status

The initial implementation is now in place. The application includes the flat-file storage engine, owner and
guest authentication, capability authorization, recipe visibility, recipe/media management, personal meal
plans and shopping lists, URL/OCR imports, search, themes, PWA shell, backups, migrations, Docker/direct-Node
deployment artifacts, and automated unit/browser smoke tests.

- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm test` — 12 unit tests passing
- [x] `npm run e2e` — 2 Chromium smoke tests passing
- [x] `npm run build` — production build passing with Node 22
- [x] Production health/setup API smoke test
- [ ] Docker image/compose verification — Docker is not available in the current environment
- [ ] Full deployment against a persistent host and reverse proxy
- [ ] Expanded adversarial and backup/restore integration test matrix

## 1. Settled product decisions

- [x] Fresh **Next.js 16 / TypeScript** application
- [x] Flat-file persistence only; no relational, document, KV, or embedded database
- [x] Optimized for one owner, fewer than 2,000 recipes, fewer than 25 accounts, and low concurrent traffic
- [x] Invited guests receive individual accounts
- [x] Owner assigns capabilities per guest
- [x] Guest meal plans and shopping lists are private per-account data
- [x] Recipe creation, editing, imports, OCR, media, account management, and configuration remain owner-only
- [x] Site-level visibility default with per-recipe overrides
- [x] Support both Docker and direct Node.js deployment
- [x] Require a persistent writable filesystem and one writable application instance
- [x] PWA installation and offline fallback, but no offline caching of protected recipe content in v1

## 2. Non-goals

- [ ] No public registration
- [ ] No guest recipe creation or editing
- [ ] No shared household meal planner in v1
- [ ] No multiple writable application replicas
- [ ] No serverless/read-only filesystem deployment
- [ ] No plugin system or Grav compatibility
- [ ] No guaranteed permanent free-hosting provider
- [ ] No protected recipe data stored in service-worker caches

## 3. Technology baseline

- [ ] Node.js 22 LTS
- [ ] Next.js 16 App Router
- [ ] React and TypeScript with strict mode
- [ ] Tailwind CSS 4
- [ ] Auth.js Credentials provider with JWT sessions and no adapter
- [ ] Zod validation for all persisted and submitted data
- [ ] Node `crypto.scrypt` for password hashing
- [ ] `proper-lockfile` or equivalent cross-process filesystem locking
- [ ] Sharp for image validation, resizing, and WebP conversion
- [ ] Fuse.js for browser-side fuzzy search
- [ ] Tesseract.js in the browser for v1 OCR
- [ ] Safe Markdown rendering with raw HTML disabled or sanitized
- [ ] Serwist for PWA shell and offline fallback
- [ ] Vitest for unit/integration tests
- [ ] Playwright for end-to-end tests

## 4. Repository structure

```
Marcia_Recipe/
├── src/
│   ├── app/
│   │   ├── (public)/
│   │   ├── (authenticated)/
│   │   ├── admin/
│   │   └── api/
│   ├── components/
│   ├── lib/
│   │   ├── auth/
│   │   ├── authorization/
│   │   ├── storage/
│   │   ├── recipes/
│   │   ├── meal-plans/
│   │   ├── shopping-lists/
│   │   ├── invitations/
│   │   ├── imports/
│   │   ├── media/
│   │   └── validation/
│   └── types/
├── scripts/
├── tests/
├── public/
├── Dockerfile
├── docker-compose.yml
└── IMPLEMENTATION_PLAN.md
```

All mutable production data lives outside the application tree:

```
DATA_ROOT=/data/marcia-recipe

/data/marcia-recipe/
├── config/
│   └── site.json
├── accounts/
│   └── <account-id>.json
├── invitations/
│   └── <invitation-id>.json
├── recipes/
│   └── <recipe-id>/
│       ├── recipe.json
│       └── media/
├── users/
│   └── <account-id>/
│       ├── meal-plans/
│       └── shopping-lists/
├── indexes/                 # Derived and rebuildable
├── audit/
├── backups/
├── locks/
└── tmp/
```

## 5. Persistence rules

- [ ] Assign every entity an immutable UUID independent of its display slug
- [ ] Use UUIDs for all relationships
- [ ] Treat slugs as validated presentation fields only
- [ ] Store each recipe's metadata, ingredients, steps, and Markdown notes in one canonical `recipe.json`
- [ ] Add `schemaVersion`, `createdAt`, and `updatedAt` to every canonical document
- [ ] Validate all loaded documents with Zod
- [ ] Reject unsupported schema versions without modifying files
- [ ] Write to a temporary file, flush it, then atomically rename it
- [ ] Verify every resolved path remains beneath `DATA_ROOT`
- [ ] Never use an unvalidated slug, username, token, or media name directly as a filesystem path
- [ ] Protect mutations with cross-process filesystem locks
- [ ] Require a single writable instance; prohibit Node cluster mode
- [ ] Treat indexes, thumbnails, and caches as disposable derived data
- [ ] Rebuild derived data after corruption or interrupted writes
- [ ] Quarantine malformed documents and report actionable errors
- [ ] Soft-delete/archive recipes by default
- [ ] Prevent permanent deletion while references exist
- [ ] Display archived-recipe tombstones in historical meal plans

## 6. Core schemas

### Account

- [ ] Include ID, normalized username, display name, password record, account type, capabilities, session version, disabled timestamp, and audit timestamps
- [ ] Reserve `owner` and `guest` account types
- [ ] Enforce normalized username uniqueness under an account-directory lock
- [ ] Increment `sessionVersion` after password changes, account revocation, or security-sensitive permission changes

### Invitation

- [ ] Use URL format `<invitation-id>.<secret>`
- [ ] Store only a hash of the secret
- [ ] Include expiration, capabilities, issuer, acceptance state, and accepted account ID
- [ ] Make invitations single-use
- [ ] Atomically prevent concurrent acceptance
- [ ] Recover from a crash occurring between account creation and invitation completion

### Recipe

- [ ] Include immutable ID and mutable unique slug
- [ ] Include visibility, title, description, times, servings, difficulty, category, tags, source URL, ingredients, steps, notes Markdown, media metadata, timestamps, and archive state
- [ ] Use visibility values: `inherit`, `public`, `members`, and `owner`
- [ ] Preserve prior slugs as optional aliases
- [ ] Validate ingredient and step ordering
- [ ] Sanitize imported and rendered text

### Meal plan

- [ ] Store plans under the owning account ID
- [ ] Use an ISO week identifier
- [ ] Reference recipes by immutable ID
- [ ] Prevent guests from accessing another account's plans
- [ ] Preserve archived-recipe references as tombstones

### Shopping list

- [ ] Store lists under the owning account ID
- [ ] Store generated items as snapshots rather than live ingredient references
- [ ] Record the source meal-plan ID when applicable
- [ ] Support checked state and manual items
- [ ] Preserve recipe attribution for generated items

## 7. Authorization model

### Assignable guest capabilities

- [ ] `recipes.read`
- [ ] `mealPlans.use`
- [ ] `shoppingLists.use`

### Owner-only capabilities

- [ ] `recipes.manage`
- [ ] `recipes.import`
- [ ] `media.manage`
- [ ] `accounts.manage`
- [ ] `site.manage`
- [ ] `backups.manage`

### Capability dependencies

- [ ] `mealPlans.use` requires `recipes.read`
- [ ] `shoppingLists.use` requires `recipes.read`
- [ ] Shopping-list generation from plans requires `mealPlans.use`
- [ ] Enforce dependencies in both the admin UI and server services

### Recipe visibility evaluation

- [ ] Owner can access every recipe
- [ ] `owner` recipes are owner-only
- [ ] `members` recipes require an enabled account with `recipes.read`
- [ ] `public` recipes are available anonymously
- [ ] `inherit` resolves against the site default
- [ ] Site default supports `public` or `members`
- [ ] Apply authorization before returning recipe metadata, content, media, search entries, or source URLs

## 8. Authentication and session security

- [ ] Configure Auth.js Credentials provider with JWT strategy and no database adapter
- [ ] Persist `AUTH_SECRET` outside the image
- [ ] Put only account ID and session version in the JWT
- [ ] Never trust JWT-stored capabilities as current authorization state
- [ ] Load the account file during every protected operation
- [ ] Reject disabled, missing, or session-version-mismatched accounts
- [ ] Centralize `requireSession`, `requireOwner`, `requireCapability`, and `canViewRecipe`
- [ ] Invoke authorization inside every mutation service, not only pages or middleware
- [ ] Apply login rate limiting by normalized username and client address
- [ ] Use secure, HTTP-only, SameSite cookies
- [ ] Validate request origins for cookie-authenticated mutations
- [ ] Avoid exposing whether a username exists during login
- [ ] Provide owner password reset through a local CLI command
- [ ] Require a deployment-provided `SETUP_TOKEN` for first-run web setup
- [ ] Create the first owner atomically and disable setup permanently afterward
- [ ] Record account, permission, invitation, and login-security events without recording secrets

## 9. Routing plan

### Anonymous and reader routes

- [ ] `/`
- [ ] `/recipes`
- [ ] `/recipes/[slug]`
- [ ] `/login`
- [ ] `/invite/[invitationId]/[secret]`
- [ ] `/offline`

### Authenticated personal routes

- [ ] `/meal-planner`
- [ ] `/shopping-lists`
- [ ] `/shopping-lists/[id]`
- [ ] `/account`

### Owner routes

- [ ] `/admin`
- [ ] `/admin/recipes`
- [ ] `/admin/recipes/new`
- [ ] `/admin/recipes/[id]/edit`
- [ ] `/admin/accounts`
- [ ] `/admin/invitations`
- [ ] `/admin/settings`
- [ ] `/admin/backups`

### API and media routes

- [ ] Auth.js handler routes
- [ ] Capability-filtered search-index endpoint
- [ ] Authorized media endpoint
- [ ] Owner-only URL import endpoint
- [ ] Owner-only image upload endpoint
- [ ] Health and readiness endpoints
- [ ] Keep internal storage paths out of API responses

## 10. Next.js caching and privacy

- [ ] Use the Node.js runtime for every route that accesses the filesystem
- [ ] Force access-controlled pages and handlers to render dynamically
- [ ] Return `private, no-cache, no-store` for authenticated and protected responses
- [ ] Do not statically generate member or owner content
- [ ] Never place recipe media or indexes in `public/`
- [ ] Authorize every media request against its recipe visibility
- [ ] Return a visibility-filtered search index for each request
- [ ] Use ETags for public data where useful, but require revalidation
- [ ] Ensure logout removes client state
- [ ] Cache only static assets and the generic offline shell in the service worker
- [ ] Add automated tests proving protected recipes are absent from browser and service-worker caches

## 11. Implementation phases

### Phase 1 — Foundation

- [ ] Initialize Next.js with TypeScript, linting, tests, and Tailwind
- [ ] Add environment validation
- [ ] Add `DATA_ROOT` resolution and startup checks
- [ ] Add structured application errors and safe logging
- [ ] Add Zod schemas and schema-version constants
- [ ] Add base application shell and theme tokens
- [ ] Add CI for type checking, linting, unit tests, and production builds

**Exit criteria**

- [ ] Application runs locally
- [ ] Missing/unwritable `DATA_ROOT` fails with a clear error
- [ ] Docker and direct Node builds succeed

### Phase 2 — Flat-file storage engine

- [ ] Implement safe path resolution
- [ ] Implement atomic JSON reads and writes
- [ ] Implement cross-process locking
- [ ] Implement account, invitation, recipe, meal-plan, shopping-list, and configuration repositories
- [ ] Implement corruption quarantine and recovery reporting
- [ ] Implement derived-index rebuilds
- [ ] Add failure-injection tests around interrupted writes
- [ ] Add schema migration command framework

**Exit criteria**

- [ ] Concurrent tests do not lose writes
- [ ] Interrupted writes do not corrupt canonical data
- [ ] Traversal attempts cannot escape `DATA_ROOT`
- [ ] Derived data can be deleted and rebuilt

### Phase 3 — Setup, authentication, and authorization

- [ ] Implement secure first-run owner setup
- [ ] Implement password hashing and verification
- [ ] Configure Auth.js JWT sessions
- [ ] Implement centralized authorization services
- [ ] Implement login/logout and owner password reset
- [ ] Implement session invalidation
- [ ] Implement security-event auditing
- [ ] Add authorization-matrix tests

**Exit criteria**

- [ ] No API or server action relies solely on UI or middleware protection
- [ ] Disabling an account invalidates access immediately
- [ ] Capability changes apply without waiting for JWT expiry
- [ ] Concurrent setup cannot create multiple owners

### Phase 4 — Recipe reading and visibility

- [ ] Implement public recipe listing and details
- [ ] Implement visibility resolution
- [ ] Render safe Markdown notes
- [ ] Implement category and tag filtering
- [ ] Add accessible empty, loading, and error states
- [ ] Add visibility tests for anonymous, guest, and owner access

**Exit criteria**

- [ ] Every visibility/account combination behaves according to the matrix
- [ ] Restricted metadata and source URLs do not leak
- [ ] Archived recipes are omitted from ordinary lists

### Phase 5 — Owner recipe management and media

- [ ] Implement owner recipe list, create, edit, archive, and restore
- [ ] Implement dynamic ingredients and steps editor
- [ ] Implement slug collision handling and aliases
- [ ] Implement media upload through an authorized route
- [ ] Validate decoded media content and pixel count
- [ ] Resize and convert images to WebP with Sharp
- [ ] Serve media through visibility checks
- [ ] Rebuild indexes after successful mutations

**Exit criteria**

- [ ] Recipe updates are atomic
- [ ] Renaming a slug does not break meal-plan references
- [ ] Private media cannot be accessed directly
- [ ] Oversized or malformed images are rejected safely

### Phase 6 — Invitations and guest administration

- [ ] Implement invitation creation with selected capabilities and expiry
- [ ] Show the raw invitation secret only once
- [ ] Implement invitation acceptance and guest account creation
- [ ] Implement guest capability editing
- [ ] Implement account disable/re-enable and session invalidation
- [ ] Implement invitation cancellation
- [ ] Avoid routine owner UI access to guests' personal planner/list contents

**Exit criteria**

- [ ] Invitation secrets are hashed at rest
- [ ] Invitations cannot be accepted twice
- [ ] Revoked guests lose access immediately
- [ ] Guests cannot access another guest's personal data

### Phase 7 — Meal planner and shopping lists

- [ ] Implement per-account weekly meal planner
- [ ] Enforce planner capability
- [ ] Generate shopping lists from authorized plans
- [ ] Port ingredient normalization and aggregation rules
- [ ] Support manual list items and checked state
- [ ] Preserve saved-list snapshots when recipes change
- [ ] Display archived recipe references safely

**Exit criteria**

- [ ] Account isolation tests pass
- [ ] Capability removal blocks use immediately
- [ ] Shopping-list generation is deterministic
- [ ] Recipe changes do not silently alter saved lists

### Phase 8 — Import and OCR

- [ ] Port JSON-LD recipe extraction
- [ ] Add Microdata and RDFa fallbacks
- [ ] Add direct, print-view, Wayback, and Jina fetch strategies
- [ ] Restrict imports to the owner
- [ ] Validate DNS resolution and every redirect against SSRF rules
- [ ] Add time, redirect, response-size, and content-type limits
- [ ] Implement browser-side Tesseract.js OCR
- [ ] Port OCR normalization and heuristic parsing
- [ ] Require owner review before imported/OCR data is saved
- [ ] Sanitize all imported values

**Exit criteria**

- [ ] SSRF tests block loopback, private, link-local, metadata, redirect, and rebinding cases
- [ ] Oversized responses terminate safely
- [ ] OCR failure cannot affect server availability
- [ ] Import never writes a recipe without owner confirmation

### Phase 9 — Search, themes, and PWA

- [ ] Build a derived search index from canonical recipe files
- [ ] Filter search-index entries through recipe authorization
- [ ] Add Fuse.js fuzzy search
- [ ] Implement editorial, warm, ocean, and minimal themes
- [ ] Implement dark/light preferences
- [ ] Add web manifest and installable PWA behavior
- [ ] Add static offline fallback
- [ ] Exclude dynamic recipe content and media from service-worker caches

**Exit criteria**

- [ ] Search returns only recipes visible to the requester
- [ ] No private data remains available after logout
- [ ] PWA installation and offline fallback work
- [ ] Automated cache-inspection tests pass

### Phase 10 — Backups, migration, and operations

- [ ] Implement a global-lock backup command
- [ ] Include canonical config, accounts, invitations, recipes, personal data, and media
- [ ] Exclude indexes, caches, locks, and temporary files
- [ ] Produce versioned archives
- [ ] Implement restore validation and dry-run mode
- [ ] Require a pre-migration backup
- [ ] Add startup integrity checks
- [ ] Add bounded audit-log rotation
- [ ] Document off-host backup procedures
- [ ] Test backup restoration

**Exit criteria**

- [ ] A restored archive reproduces the original canonical data
- [ ] Backups cannot capture partially written operations
- [ ] Migrations are repeatable and version-aware

### Phase 11 — Deployment

#### Docker

- [ ] Create a multi-stage non-root image
- [ ] Mount one persistent directory at `DATA_ROOT`
- [ ] Handle volume ownership safely
- [ ] Add health and readiness checks
- [ ] Add graceful shutdown
- [ ] Provide Docker Compose with one application replica
- [ ] Document reverse proxy and TLS configuration

#### Direct Node

- [ ] Document Node.js 22 installation
- [ ] Document `npm ci`, build, and production start
- [ ] Provide a systemd service example
- [ ] Configure a dedicated OS user and restricted filesystem permissions
- [ ] Document Caddy or Nginx TLS proxying
- [ ] Document backup scheduling and log rotation

**Exit criteria**

- [ ] Both deployment modes persist data across application upgrades
- [ ] Neither deployment runs multiple writers
- [ ] Application code remains immutable
- [ ] Secrets and `DATA_ROOT` remain outside the repository and image

## 12. Required test matrix

- [ ] Storage CRUD and schema validation
- [ ] Atomic-write interruption recovery
- [ ] Lock contention
- [ ] Path traversal and malformed identifiers
- [ ] Slug rename and collision behavior
- [ ] Account and invitation races
- [ ] JWT session invalidation
- [ ] Capability dependency enforcement
- [ ] Anonymous/guest/owner visibility matrix
- [ ] Cross-account planner/list isolation
- [ ] CSRF and origin validation
- [ ] Login rate limiting
- [ ] SSRF, redirect, DNS, timeout, and response-size restrictions
- [ ] Image MIME, decompression, and pixel-limit validation
- [ ] Markdown/import sanitization
- [ ] Protected media authorization
- [ ] Search-index filtering
- [ ] Service-worker cache inspection
- [ ] Backup/restore round trip
- [ ] Schema migration from an older fixture
- [ ] Docker restart and upgrade persistence
- [ ] Direct Node restart persistence

## 13. Definition of done

- [ ] All recipe_binder-equivalent core features are present
- [ ] No database service or embedded database is used
- [ ] All mutable state is beneath one configurable `DATA_ROOT`
- [ ] Owner and guest permissions are enforced server-side
- [ ] Account revocation takes effect immediately
- [ ] Public, member, and owner recipe visibility is tested
- [ ] Guest personal data is isolated
- [ ] Protected content is absent from public files and offline caches
- [ ] Canonical writes survive interruption without corruption
- [ ] Backups and restoration are tested
- [ ] Docker and direct Node deployment guides are complete
- [ ] Security-sensitive routes pass the required abuse tests
- [ ] Production build, type checking, linting, unit tests, and end-to-end tests pass

## 14. Deferred enhancements

- [ ] Shared household meal plans and lists
- [ ] Guest recipe contributions with owner approval
- [ ] Encrypted offline access to restricted recipes
- [ ] Multiple writers or clustered deployment
- [ ] External object-storage adapter
- [ ] Git-based revision history
- [ ] Recipe revisions and rollback UI
- [ ] Multi-language content
- [ ] API keys or third-party integrations
