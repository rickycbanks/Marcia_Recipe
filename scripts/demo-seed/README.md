# Demo seed assets

This directory is the **immutable canonical source** for the public demo at
https://recipes-demo.inthesky.dev.  It is committed to the repository and
restored into the demo `DATA_ROOT` on every reset (hourly and after every
`for_demo` deploy).  Public-writable user changes are wiped on each reset.

> ## Status: empty — must be populated before deployment
>
> This directory is intentionally empty until a maintainer commits a known-good
> seed.  Until then `npm run cli:restore-demo-seed` will refuse to run and the
> demo reset workflow will fail loudly rather than silently re-applying the
> corrupted catalog.  See "Regenerating" below.

## Layout

```
scripts/demo-seed/
  manifest.json            ← repo-managed seed manifest (sha256 + media ids)
  README.md                ← this file + an auto-generated recipe table
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
slug nor array position.  The restore path uses each `recipe.media[i].id` to
name the destination file, so array ordering cannot silently swap image bytes
between recipes.  The original mismatch bug wrote bytes under `media[0].id`
regardless of which item was primary; that pattern is gone.

## Regenerating

1. Spin up — or point at — a Marcia instance whose catalog visibly matches each
   recipe title (correct the demos at https://recipes-demo.inthesky.dev via the
   admin UI first if needed).
2. From a host with `tsx`:
   ```sh
   npm run cli:generate-demo-seed -- \
     --app-origin https://recipes-demo.inthesky.dev \
     --username demo --password 'demo123456' \
     --output-dir scripts/demo-seed
   ```
3. **Visually verify** `scripts/demo-seed/README.md` — every recipe's primary
   image must visibly match the title.
4. Run the integrity validator:
   ```sh
   npm run cli:validate-demo-seed -- --output-dir scripts/demo-seed
   ```
5. Commit `scripts/demo-seed/` (manifest, README, all webps, accounts, config).

The validator also runs in CI on PRs that touch `scripts/demo-seed/`; a tampered
or stale file is rejected before merge.

## Restoring into a demo DATA_ROOT

```sh
npm run cli:restore-demo-seed -- \
  --output-dir scripts/demo-seed \
  --data-root /data/demo \
  --force
```

The restore packs the seed files into a standard Marcia backup tarball in a
temp dir and delegates to `restoreBackup` from `src/lib/backups/restore.ts`.
That path already:
- validates every document against its Zod schema,
- asserts `recipe.media[i].fileName === "${id}.webp"`,
- asserts every media file referenced by a recipe exists in the archive,
- asserts every archive media file is referenced by a recipe,
- requires at least one enabled owner account,
- performs an atomic `DATA_ROOT` swap so reads during reset stay consistent.

In the demo host the workflow invokes the same script through a `tools`-profile
Docker stage that shares the demo's data volume — see
`.github/workflows/reset-demo.yml`.