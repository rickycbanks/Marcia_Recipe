# Cloud OCR setup (PRIVATE_CONFIG_KEYRING)

[← Back to Marcia Recipe](../README.md)

Server-side OCR (Mistral, Gemini) requires encryption keys stored in
`PRIVATE_CONFIG_KEYRING`. The owner selects the site-wide OCR provider in Admin Settings
(`/admin/settings`). Available providers:

| Provider | Required fields | Notes |
| --- | --- | --- |
| **Tesseract** | _(none)_ | Browser-side only; always available, no API key needed. Runs locally in the user's browser. |
| **Mistral** | API key | Server-side two-pass: `mistral-ocr-latest` for OCR, `ministral-3b-2512` for structured extraction. |
| **Gemini** | API key | Server-side two-pass: `gemini-3.5-flash-lite` for both OCR and structured extraction via the Google Generative Language API. |

Users **cannot** choose or override the provider at import time — the admin-selected provider is
used for all server-side OCR calls. Tesseract always runs in the browser; the cloud providers run
server-side when configured. Legacy providers (Veryfi, Google Document AI) have been removed; their
credentials are safely discarded on the next settings save.

Generate and configure the encryption key automatically:

```sh
# Initial setup (writes PRIVATE_CONFIG_KEYRING to your env file):
npm run cli:setup-private-config-keyring -- --env-target .env

# Print the keyring value (for manual inspection or backup):
npm run cli:setup-private-config-keyring -- --env-target .env --print

# Rotate the key (prepend a new key, keep old keys for decryption):
npm run cli:setup-private-config-keyring -- --env-target .env --rotate

# Use a custom key ID (default is "main"):
npm run cli:setup-private-config-keyring -- --env-target .env --key-id backup

# For a systemd-managed deployment:
npm run cli:setup-private-config-keyring -- --env-target /etc/marcia-recipe/marcia-recipe.env
```

The CLI writes only to the explicit `--env-target` path, refuses to overwrite symlinks, rejects
duplicate `PRIVATE_CONFIG_KEYRING` assignments in the target file, and sets mode `0600` on POSIX
systems. The keyring is a comma-separated list of `keyId:base64url` pairs — the first key encrypts,
all keys decrypt (for rotation).

Without `PRIVATE_CONFIG_KEYRING`, only browser-local Tesseract OCR is available. Cloud provider
credentials cannot be saved without an encryption key. In Docker Compose the variable is optional
(`${PRIVATE_CONFIG_KEYRING:-}`) so legacy operation continues to work. **You must retain and secure
the keyring separately** — losing it makes stored cloud credentials unrecoverable.
