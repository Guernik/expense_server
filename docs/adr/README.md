# Architecture Decision Records

Format: Context, Decision, Consequences, Alternatives. Status is one of `Accepted`, `Superseded by ADR-XXXX`. Number sequentially, never reuse.

| ADR | Title |
|---|---|
| [0001](0001-regex-only-purchase-classification.md) | Purchase classification is regex-only |
| [0002](0002-yaml-rule-packs.md) | Classifier rules are YAML with named capture groups |
| [0003](0003-runtime-user-rules.md) | Runtime user rules take precedence over packs |
| [0004](0004-runtime-agnostic-core.md) | Runtime-agnostic core, Cloudflare as default runtime |
| [0005](0005-sqlite-dialect-drizzle.md) | SQLite dialect only, via Drizzle |
| [0006](0006-derived-group.md) | Category belongs to one group, group is derived |
| [0007](0007-react-spa-trpc.md) | React SPA with tRPC for the dashboard |
| [0008](0008-better-auth-google.md) | Better Auth with Google and an email allowlist |
| [0009](0009-nx-monorepo.md) | Nx + npm workspaces monorepo |
| [0010](0010-optional-pluggable-llm.md) | LLM is optional and pluggable |
| [0011](0011-dedupe-window.md) | Dedupe by amount + currency within 30 seconds |
| [0012](0012-telegram-primary-interaction.md) | Telegram is the primary interaction surface |
| [0013](0013-local-dev-bot.md) | Local development uses a separate dev bot with polling |
