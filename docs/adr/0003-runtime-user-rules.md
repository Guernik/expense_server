# ADR-0003: Runtime user rules take precedence over packs

Status: Accepted (2026-10-05)

## Context
Bundled packs can't enumerate every promo notification, and a user may need to override a pack rule that misfires on their notifications. With regex-only classification (ADR-0001), unmatched events would keep prompting the user.

## Decision
User rules use the pack schema (ADR-0002), are stored in the DB, and are evaluated **before** bundled packs. They are created from Telegram:
- "Ignore similar" after NON-PURCHASE or "Not a purchase": escaped title, numbers generalized, user confirms the regex.
- After PURCHASE on an unmatched event: the LLM proposes a purchase rule. The server validates it against the event (it must reproduce the confirmed fields) before offering it for confirmation.

## Consequences
- Prompt noise drops over time without code changes.
- A bad user rule can shadow pack rules. Mitigation: the user confirms every rule, the digest lists possible misses, and v2 adds a rule editor with a tester.

## Alternatives
- Packs first, user rules as fallback: rejected because then users can't override a misfiring pack rule.
- Only code changes for new rules: rejected as too slow for end users of an installable product.
