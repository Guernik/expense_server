# ADR-0007: React SPA with tRPC for the dashboard

Status: Accepted (2026-10-05)

## Context
The dashboard is read-only in v1 but grows into re-categorization, taxonomy management, and rule editing with a live tester in v2.

## Decision
React SPA: Vite, TanStack Router + Query, Tailwind, shadcn/ui. Served as static assets by the same runtime. The dashboard API is tRPC on Hono (`@hono/trpc-server`). The MacroDroid and Telegram webhooks stay as plain Hono routes.

## Consequences
- End-to-end types between API and UI.
- Client build step and client state to maintain.
- tRPC is internal. External integrations use plain HTTP routes.

## Alternatives
- SSR with Hono JSX + htmx: simpler, but rejected in favor of richer v2 interactivity.
- Hono RPC client: viable, but tRPC was preferred.
