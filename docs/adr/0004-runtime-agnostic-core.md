# ADR-0004: Runtime-agnostic core, Cloudflare as default runtime

Status: Accepted (2026-10-05)

## Context
The reference instance runs on Cloudflare (`denarii.emilioguernik.com`). The project is open source and should be easy to self-host.

## Decision
`packages/core` holds all domain logic and depends only on interfaces: `Store`, `LlmProvider`, `Messenger`, `Clock`, `Scheduler`. Two runtimes implement them:
- `apps/cloudflare` (default): Worker, D1, Cron Triggers, static assets, `waitUntil`.
- `apps/node`: Node, better-sqlite3, node-cron, Telegram polling or webhook. Shipped as a GHCR Docker image with docker-compose. An optional `cloudflared` profile is off by default.

Hono serves the HTTP layer on both.

## Consequences
- Domain logic is tested once, independent of the runtime.
- Two runtimes to keep working in CI.
- Runtime-specific features (e.g. Queues, Durable Objects) can only be used behind core interfaces.

## Alternatives
- Cloudflare-only: rejected because self-hosting is a goal.
- Node-only: rejected because Cloudflare gives free, always-on HTTPS with zero ops for the reference instance.
