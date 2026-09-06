# Branch system & demo instance

[← Back to Marcia Recipe](../README.md)

## Branch system

This repository uses a four-branch system:

| Branch | Purpose |
| --- | --- |
| `main` | Main development branch. All feature work lands here first. |
| `for_personal` | Builds the personal instance deployed to Oracle Cloud. Pushes to this branch trigger the `Deploy Personal` GitHub Action. |
| `for_demo` | Builds the public demo instance deployed to Oracle Cloud. Pushes to this branch trigger the `Deploy Demo` GitHub Action. The demo is **seeded and auto-reset every hour** — see [Demo instance](#demo-instance) below. |
| `for_public` | Tagged releases for self-hosters who want to download and run their own instance. Releases are cut from this branch. |

## Demo instance

A live demo is hosted at **https://recipes-demo.inthesky.dev** (note the hyphen — underscores
are not valid in domain names per RFC 1034 and Let's Encrypt will not issue certificates for them).

- **Username:** `demo`
- **Password:** `demo123456`

The demo is **reset to a seeded state every hour** (at :00 UTC) via a cron job on the host that
restores from a seed backup. The seed contains the owner account above and 8 sample recipes
(2 breakfast, 2 dinner, 2 lunch, 2 dessert) with images. Any changes made to the demo — new
recipes, edited recipes, new accounts — are wiped on the next reset.

The reset is also available as a manual GitHub Action (`Reset Demo` workflow) for on-demand resets.

> **Security note:** the demo account is intentionally low-security. Do not store anything
> sensitive on the demo instance. The personal instance (`for_personal` branch) is separate and
> uses its own credentials and data volume.
