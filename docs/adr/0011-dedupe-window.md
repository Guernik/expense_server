# ADR-0011: Dedupe by amount + currency within 30 seconds

Status: Superseded by ADR-0014

## Context
MacroDroid can fire twice for one notification. One payment can also produce notifications from two apps (e.g. Mercado Pago and the card issuer).

## Decision
A new purchase or transfer event is merged into an existing purchase when the user, `amount_minor`, and `currency` are the same and `received_at` is within ±30 seconds. The merged purchase keeps the richer extraction and links all source events.

## Consequences
- Two genuinely identical purchases within 30 seconds are merged. Accepted as rare.
- Anything after 30 seconds is a new purchase, even if it's identical.

## Alternatives
- Hash of the raw text: misses cross-app duplicates.
- Wider window (minutes): too many false merges.
- Ask the user on every possible duplicate: too noisy.
