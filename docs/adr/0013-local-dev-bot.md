# ADR-0013: Local development uses a separate dev bot with polling

Status: Accepted (2026-10-08)

## Context
Testing a change end to end needs Telegram: the bot sends the picker and button taps come back as updates. Production registers a webhook (ADR-0012), so a local Worker never receives taps unless the production webhook is pointed at a tunnel and restored afterwards. While it is swapped, production taps fail. `.dev.vars` also held the production secrets, so local runs talked to the real chat with the real bot.

## Decision
Two environments: local and production.
- Local uses its own Telegram bot (created in @BotFather) with no webhook. `apps/cloudflare/.dev.vars` holds only its secrets.
- `just dev` applies local migrations, runs `wrangler dev` and long-polls the dev bot with `getUpdates`, forwarding each update to the local `/api/telegram` with the `X-Telegram-Bot-Api-Secret-Token` header. The Worker code is unchanged: it only ever sees webhook requests.
- Production secrets live in the deployed Worker and in the git-ignored `apps/cloudflare/.prod.vars`, which the ops recipes in the `justfile` read and update. `just ingest` targets local, `just ingest-prod` production.

## Consequences
- No tunnel, public URL or webhook swapping to test locally. Production is never touched by local runs.
- The dev bot is a second chat to keep open. Its `TELEGRAM_CHAT_ID` is the same as production's, since a private chat id is the user id.
- The polling bridge is dev tooling in the `justfile`, not runtime code, so the core stays runtime-agnostic (ADR-0004).

## Alternatives
- Named Cloudflare Tunnel with a fixed hostname as the dev bot's webhook: no polling, but needs a domain on Cloudflare and a running `cloudflared`.
- A staging environment (`env.staging` in `wrangler.jsonc`, own D1, own bot): a second deployment to maintain, not needed for a single-user app yet.
