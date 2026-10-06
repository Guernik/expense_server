# ADR-0009: Nx + pnpm monorepo

Status: Accepted (2026-10-05)

## Context
The repo holds several packages (core, db, llm, api, cli), two runtimes (cloudflare, node), a web app, and rule packs.

## Decision
pnpm workspaces for dependencies, Nx for the task graph, caching, and `nx affected` in CI.

## Consequences
- Fast CI that only checks what changed.
- Nx config to maintain.

## Alternatives
- Turborepo: explicitly excluded.
- Plain pnpm workspaces: no task graph or caching.
