# Portable dev environment (distrobox)

[← Back to Marcia Recipe](../README.md)

Marcia Recipe ships a **portable, disposable development environment** built with
[distrobox](https://github.com/89luca89/distrobox) on rootless podman. The container holds only
the toolchain (Node.js 22, git, and friends). Your **project, `node_modules`, `.env`, and
`data/` all live in your bind-mounted home directory and persist on the host** — so the container
can be deleted and recreated at any time without losing anything.

The whole environment is defined by a single version-controlled file:
[`dev/distrobox.ini`](../dev/distrobox.ini). Recreate it on any machine with one command.

## Why distrobox

- **Reproducible** — the toolchain is declared in `dev/distrobox.ini`, not installed by hand.
- **Portable** — the same ini recreates the env on any Linux machine with podman + distrobox.
- **Disposable** — wipe the container and rebuild; your code and data are untouched (they live in
  your home directory, which is mounted into the container at the same path).
- **No host pollution** — Node, npm, and friends live in the container, not on your host.
- **Secrets stay out of the image** — `.env` is read from your mounted home at runtime; it is
  never baked into the container.

## Requirements

Linux with **rootless podman** and **distrobox**:

```sh
sudo dnf install podman distrobox
```

## Create the environment

From the repository root:

```sh
distrobox-assemble create --file dev/distrobox.ini
```

This pulls a Fedora image, installs the toolchain, and creates a container named `marcia-dev`.

## Day-to-day use

```sh
distrobox enter marcia-dev          # open a shell inside the container
cd ~/Projects/Marcia_Recipe        # same path as on the host (home is mounted)
npm ci                             # first time only (node_modules persists on the host)
cp .env.example .env               # then edit AUTH_SECRET / SETUP_TOKEN
npm run dev                        # -> http://localhost:3000
```

Your host editor (VS Code, Cursor, etc.) edits `~/Projects/Marcia_Recipe` directly — the container
is the runtime, not the editor.

### Common commands

```sh
npm run dev            # dev server (http://localhost:3000)
npm run build          # production build
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm test               # vitest (unit tests)
npm run e2e            # playwright browser tests (see below)
npm run cli:backup     # any cli:* script (backup, restore, migrate, ...)
```

### Playwright / e2e (optional, ~300 MB+)

The e2e tests need a browser. Install it once inside the container:

```sh
npx playwright install --with-deps chromium
npm run e2e
```

The container is created with `--ipc=host` so Chromium's shared memory works. If you ever hit
sandbox errors, either add `--security-opt seccomp=unconfined` to `additional_flags` in
`dev/distrobox.ini`, or set `chromiumSandbox: false` in `playwright.config.ts`.

## Networking

The container **publishes port 3000** (`-p 3000:3000` in `dev/distrobox.ini`), so the dev server is
reachable from your host browser at `http://localhost:3000`. Next.js binds to all interfaces by
default, so plain `npm run dev` works — no extra flags.

If you'd rather share the host network namespace (no port mapping, exact `localhost` parity),
set `additional_flags="--network=host"` in `dev/distrobox.ini` and run plain `npm run dev`.

## Recreating / updating the environment

`dev/distrobox.ini` sets `replace=true`, so re-running the assemble command rebuilds the container
from scratch. Your home directory — code, `node_modules`, `.env`, `data/` — is mounted in and
untouched:

```sh
distrobox-assemble create --file dev/distrobox.ini   # rebuild after editing the ini
distrobox enter marcia-dev
```

To remove it entirely:

```sh
distrobox rm marcia-dev
```

## Moving to a new machine

1. `sudo dnf install podman distrobox`
2. Clone the repo to `~/Projects/Marcia_Recipe`
3. `distrobox-assemble create --file dev/distrobox.ini`
4. `distrobox enter marcia-dev` → `npm ci` → `cp .env.example .env` → `npm run dev`

`dev/distrobox.ini` + the lockfile are the whole environment definition. (You can also snapshot a
built container with `distrobox export marcia-dev -o marcia-dev.tar` and `distrobox import
marcia-dev.tar`, but the assemble file is preferred because it's version-controlled.)

## How it works

| Piece | Where it lives | Persists? |
| --- | --- | --- |
| Toolchain (Node 22, git, …) | inside the `marcia-dev` container | rebuilt from `dev/distrobox.ini` |
| Source code | `~/Projects/Marcia_Recipe` (mounted home) | yes, on the host |
| `node_modules` | `~/Projects/Marcia_Recipe/node_modules` (mounted home) | yes, on the host |
| `.env` secrets | `~/Projects/Marcia_Recipe/.env` (mounted home) | yes, on the host — never in the image |
| App data (`DATA_ROOT`) | `~/Projects/Marcia_Recipe/data` (mounted home) | yes, on the host |

Distrobox bind-mounts your home directory into the container at the **same path** and creates a
user with the **same UID**, so files written inside (e.g. `node_modules`) are owned correctly on
the host.
