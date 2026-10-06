# ADR-0010: LLM is optional and pluggable

Status: Accepted (2026-10-05)

## Context
LLMs help with category suggestions, field extraction for unmatched purchases, and rule proposals. Self-hosters may not want an API key or a paid provider.

## Decision
A single `LlmProvider` interface with three structured-output operations: `suggestCategory`, `extractPurchase`, `proposeRule`. Providers: Anthropic (default model `claude-haiku-4-5`), OpenAI (OpenAI-compatible base URL), Workers AI. `LLM_PROVIDER=none` is the default. Calls time out at 10s, and every failure falls back to the manual path.

LLM output is never applied without the user: suggestions are one-tap buttons, extractions are confirmed, and proposed rules are validated by the server and then confirmed.

## Consequences
- Works fully without an LLM. Users type amount and merchant, and pick categories by hand.
- Three providers to test against one contract.

## Alternatives
- Require one provider: rejected because it raises the install barrier.
- LLM auto-accept above a confidence threshold: rejected because LLM confidence is unreliable. Can be revisited.
