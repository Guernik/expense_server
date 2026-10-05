# ADR-0006: Category belongs to one group, group is derived

Status: Accepted (2026-10-05)

## Context
Each purchase has exactly one category, and each category belongs to exactly one group (Delivery -> Food). The user must be able to move a category to another group, with totals recalculating automatically.

## Decision
`categories.group_id` is the only link to groups. Purchases store `category_id` only. Totals join `purchases -> categories -> groups`.

## Consequences
- Moving a category to another group is a single-row update, and every total, past ones included, follows.
- There is no historical "group at time of purchase". Accepted.

## Alternatives
- Store `group_id` on purchases: needs backfill on every reassignment and can drift.
- Groups as free tags: rejected because the user wants a strict hierarchy.
