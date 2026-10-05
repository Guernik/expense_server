# ADR-0012: Telegram is the primary interaction surface

Status: Accepted (2026-10-05)

## Context
Decisions about purchases are needed right after paying, on the phone. The dashboard is for review.

## Decision
All capture-time decisions happen in Telegram:
- category picker with LLM suggestion and top categories
- new category / new group
- PURCHASE / NON-PURCHASE for unmatched events
- transfer handling
- comments by replying to the bot's message
- `/pending`, `/setgroup`, daily digest

Categorizing a purchase automatically creates or updates its merchant rule. Rule-matched purchases get a short confirmation with a "Change" button. The bot only talks to `TELEGRAM_CHAT_ID`. Cloudflare uses webhook mode. Node defaults to polling, so no public URL is needed for the bot.

## Consequences
- The happy path is zero or one tap per purchase.
- Conversation state (awaiting free-text input) needs persisting in `chat_state`.
- Telegram is a hard dependency for capture. Other messengers would implement `Messenger`.

## Alternatives
- Dashboard-only categorization: too slow, decisions get batched and forgotten.
- Ask before creating each merchant rule: adds a tap to every new merchant.
