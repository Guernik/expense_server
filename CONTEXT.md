# Domain Context

Ubiquitous language for denarii. Code, docs, UI strings, and conversations use these terms. Full behavior lives in [SPEC.md](SPEC.md). Decisions live in [docs/adr/](docs/adr/).

## Core terms

**Event**
One raw notification received from MacroDroid: `app`, `title`, `text`, `received_at`. Every event is stored, whatever happens to it (audit trail).

**Classifier**
Engine that decides an event's **kind** by evaluating classifier rules in order. First match wins. It is the only thing that decides whether something is a purchase (see ADR-0001).

**Classifier rule**
A declarative regex rule (`match` on title/text/app, named capture groups, `transform`, `tests`) with a kind: `purchase`, `transfer` or `ignore`.

**Rule pack**
A YAML file of classifier rules for one provider, bundled in `rules/` (e.g. `ar.galicia`). Enabled per install through `RULE_PACKS`.

**User rule**
A classifier rule created at runtime (e.g. through "Ignore similar" or a confirmed LLM rule proposal) and stored in the DB. Evaluated before rule packs.

**Purchase**
An expense derived from one or more events. Has `amount_minor`, `currency`, merchant, payment method, `occurred_at`, category, comment. A purchase's `kind` is `purchase` or `transfer`.

**Transfer**
A purchase with `kind = transfer` (outgoing money transfer). Whether it counts as an expense is decided by the user. Never creates merchant rules.

**Merchant**
Who was paid. Stored raw (`merchant_raw`) and normalized (`merchant_normalized`: entities decoded, uppercased, whitespace collapsed, processor prefixes like `MERPAGO=` / `DLO*` stripped). `Unknown` is a reserved merchant for notifications without one.

**Payment method**
Where the money came from, e.g. `Galicia Visa Crédito 3551`, `Mercado Pago cuenta`. Created automatically the first time it is seen.

**Category**
Exactly one per purchase, e.g. `Delivery`.

**Group**
Exactly one per category, e.g. `Food`. A purchase's group is always derived through its category, never stored on the purchase (see ADR-0006).

**Merchant rule**
Exact mapping from `merchant_normalized` to a category. Created or updated automatically whenever the user categorizes a purchase.

**Suggestion**
An LLM-proposed category for a purchase. Never applied without user confirmation.

**Dedupe**
Merges events that describe the same purchase: same amount and currency, `received_at` within ±10 seconds (see ADR-0014).

**Digest**
Daily Telegram summary of pending purchases, unanswered unmatched events, and possible classifier misses. Only sent when non-empty.

## Lifecycles

**Event status**
- `purchase` / `transfer`: matched a rule of that kind and produced (or created) a purchase.
- `ignored`: matched an `ignore` rule.
- `unmatched`: no rule matched. Waiting for the user to answer PURCHASE / NON-PURCHASE.
- `non_purchase`: user answered NON-PURCHASE.
- `duplicate`: linked to an existing purchase by dedupe.

**Purchase status**
- `pending`: no category yet, waiting for the user.
- `categorized`: has a category. Counts in totals.
- `excluded`: kept for audit, not counted ("Not a purchase", or a transfer marked "Not an expense").

## Relationships

```
Event *--1 Purchase (optional; several events can merge into one purchase)
Purchase *--1 Category *--1 Group
Purchase *--1 Payment method
Merchant rule 1--1 merchant_normalized --> Category
Classifier rule (pack | user) --> matches Event
```

## Terms to avoid

| Avoid | Use |
|---|---|
| transaction, expense (as entity name) | **purchase** |
| card | **payment method** |
| tag, label, parent category | **group** |
| notification (as stored entity) | **event** |
| filter, pattern (for classifier rules) | **classifier rule** |
| mapping, auto-category | **merchant rule** |
