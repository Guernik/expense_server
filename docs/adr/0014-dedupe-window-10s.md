# ADR-0014: Dedupe window narrowed to 10 seconds

Status: Accepted (2026-10-08)

Supersedes ADR-0011.

## Context
ADR-0011 merges events with the same amount and currency within ±30 seconds. Duplicate notifications (MacroDroid double fires, two apps reporting one payment) arrive within a few seconds of each other, so 30 seconds merges more genuinely separate purchases than it needs to.

## Decision
Same rule as ADR-0011 (user, `amount_minor`, `currency`), with `received_at` within ±10 seconds.

## Consequences
- Fewer false merges of identical purchases made close together.
- A duplicate notification delayed more than 10 seconds becomes a separate purchase.

## Alternatives
- Keep 30 seconds: more false merges for no observed benefit.
- Narrower (a few seconds): risks missing cross-app duplicates.
