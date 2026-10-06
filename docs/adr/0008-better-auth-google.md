# ADR-0008: Better Auth with Google and an email allowlist

Status: Accepted (2026-10-05)

## Context
The dashboard needs auth that works on both runtimes (ADR-0004), uses an industry-standard login, and supports multi-user later.

## Decision
Better Auth with the Google provider. Sessions live in the app database. In v1, sign-in is restricted to `ALLOWED_EMAILS`.

## Consequences
- Same auth on Cloudflare and Node, no vendor lock-in.
- Each install needs its own Google OAuth client.
- Multi-user (v2) builds on the existing users and sessions.

## Alternatives
- Cloudflare Access: zero code, but Cloudflare-only.
- Auth.js: less natural fit for Hono + Workers.
- Hand-rolled OIDC: unnecessary to maintain.
