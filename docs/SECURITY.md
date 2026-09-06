# Security & privacy notes

[← Back to Marcia Recipe](../README.md)

## Design

- Auth.js (next-auth v5) Credentials provider with JWT sessions — **no database adapter**
- JWTs carry only the account ID and session version — never capabilities
- Capabilities are reloaded from the account file on **every** protected operation
- Login rate limiting by username and client address
- Secure, HTTP-only, SameSite cookies
- Same-origin validation on all cookie-authenticated mutations
- Owner password reset via local CLI (no email dependency)

## Operational notes

- Guest capabilities reload from the account file on every protected request — revocation is immediate
- JWTs contain only the account ID and session version; they are **not** the authorization source of truth
- Private recipe pages, search entries, media, API responses, and personal data are **not** service-worker cached
- URL import validates protocol, ports, DNS results, redirects, response size, content type, and timeouts
- Recipe imports and OCR produce drafts; nothing is saved until the owner reviews and submits
- Keep `DATA_ROOT` outside the repository and never commit `.env` or backup archives
