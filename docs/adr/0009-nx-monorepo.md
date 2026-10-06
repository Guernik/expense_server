# ADR-0009: Nx + npm workspaces monorepo

Status: Accepted (2026-10-05, amended 2026-10-06: npm instead of pnpm)

## Context
The repo holds several packages (core, db, llm, api, cli), two runtimes (cloudflare, node), a web app, and rule packs.

## Decision
npm workspaces for dependencies, Nx for the task graph, caching, and `nx affected` in CI.

## Consequences
- Fast CI that only checks what changed.
- Nothing to install beyond Node. Contributors already know npm.
- Slower installs and a less strict dependency layout than pnpm. Acceptable at this repo's size.
- Nx config to maintain.

## Alternatives
- pnpm: stricter and faster, rejected because of bad past experiences with it.
- Bun as package manager: fast, but an extra tool for contributors and Nx support is newer.
- Turborepo: explicitly excluded.
- Plain npm workspaces without Nx: no task graph or caching.
