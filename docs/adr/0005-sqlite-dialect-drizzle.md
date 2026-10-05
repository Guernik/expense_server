# ADR-0005: SQLite dialect only, via Drizzle

Status: Accepted (2026-10-05)

## Context
D1 is SQLite. Self-hosters need an embedded database with no extra service.

## Decision
SQLite is the only supported dialect: D1 on Cloudflare, better-sqlite3 on Node. One Drizzle schema and one migration set in `packages/db`. Money is stored as integer minor units plus an ISO currency. Every domain table has `user_id`.

## Consequences
- One schema, one set of migrations, identical behavior across runtimes.
- No Postgres or MySQL. Adding one later means a second migration set.
- Google Sheets isn't a store. An export can be added later.

## Alternatives
- Google Sheets as the primary store: fragile (concurrency, schema drift, API limits).
- Postgres for self-host: adds a service and a second dialect.
