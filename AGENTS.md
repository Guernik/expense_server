# AGENTS.md

Instructions for coding agents working on denarii (repo: `expense_server`).

## Read first

- [SPEC.md](SPEC.md): product spec. Source of truth for behavior.
- [CONTEXT.md](CONTEXT.md): domain language. Use its terms in code, tests, UI strings and commits.
- [docs/adr/](docs/adr/): architecture decisions. Don't contradict an accepted ADR. If a change requires it, write a new ADR that supersedes it.

## Project status

Pre-implementation. Only docs exist. Build commands will be added here once the Nx workspace exists.

## Invariants

- **Purchase detection is regex-only.** Never let an LLM decide whether an event is a purchase (ADR-0001). LLMs may only suggest categories, extract fields after the user said PURCHASE, and propose rules that the server validates.
- **Every event is stored** before any processing.
- **`packages/core` is runtime-agnostic.** No Cloudflare, Node, or DB-driver imports. It talks only through the `Store`, `LlmProvider`, `Messenger`, `Clock`, `Scheduler` interfaces (ADR-0004).
- **SQLite dialect only** (D1 and better-sqlite3) via Drizzle. Queries must work on both (ADR-0005).
- **Every domain table has `user_id`**, even though v1 is single-user.
- **Group is derived** through category. Never store a group on a purchase (ADR-0006).
- **Money is integer minor units + ISO currency.** No floats, no conversion.
- **LLM is optional.** Every flow must work with `LLM_PROVIDER=none`.
- **All user-facing strings go through i18n** (`en`, `es`). No hardcoded text in Telegram flows or the SPA.
- **Telegram `callback_data` stays under 64 bytes.**

## Rule packs

- Live in `rules/<country>/<provider>.yaml` and must validate against the rule schema.
- Every rule needs at least one inline `tests` entry. New banks/formats need fixtures in `fixtures/`.
- `ignore` rules that overlap a broader `purchase` rule need a higher `priority` (e.g. `Pagaste tu tarjeta` before `Pagaste`).
- Fixtures must be anonymized: no real card numbers beyond the last 4 digits, no personal names.

## Conventions

- TypeScript, strict mode. Vitest for tests.
- Nx + pnpm workspaces (ADR-0009). Don't introduce Turborepo.
- The open-source repo is public: never commit secrets, real notification logs, or personal data.
