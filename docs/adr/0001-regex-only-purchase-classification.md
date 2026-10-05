# ADR-0001: Purchase classification is regex-only

Status: Accepted (2026-10-05)

## Context
Banking apps send many notifications: purchases, card bill payments, declines, transfers, income, promos. Some non-purchases look like purchases (`Pagaste tu tarjeta VISA✅` vs `Pagaste $15.000`). Counting a non-purchase as an expense (or the reverse) corrupts totals silently.

## Decision
Only classifier rules (regex) decide an event's kind (`purchase`, `transfer`, `ignore`). When no rule matches, the event is `unmatched` and the user decides via Telegram (PURCHASE / NON-PURCHASE). An LLM never decides whether something is a purchase.

## Consequences
- Classification is deterministic, testable, and reproducible from stored events.
- New notification formats need a rule. Until then they reach the user as unmatched, and the user can create rules from Telegram (ADR-0003).
- More Telegram prompts at first, mostly promos, until "Ignore similar" rules build up.

## Alternatives
- LLM classification for unmatched events: rejected as non-deterministic, and it could misclassify bill payments as purchases.
- Drop unmatched events: rejected because purchases in new formats would be lost silently.
