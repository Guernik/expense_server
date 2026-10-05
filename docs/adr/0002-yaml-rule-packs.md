# ADR-0002: Classifier rules are YAML with named capture groups

Status: Accepted (2026-10-05)

## Context
Rules must match notifications and extract fields (amount, currency, merchant, payment method, time). The project is open source and should accept contributions for new banks and countries without code changes. Rules also have to be creatable at runtime (ADR-0003).

## Decision
Rules are declarative YAML, grouped into packs (`rules/<country>/<provider>.yaml`):
- `match` regexes on title/text/app, with named capture groups for extraction
- `transform` for number format, currency map, payment method template, prefix stripping
- inline `tests`

A Zod schema validates them and generates a JSON Schema for editor autocomplete. Pack rules require tests, and CI runs them plus a fixture corpus.

## Consequences
- Contributors add a bank by adding a YAML file with tests.
- The same schema stored as JSON in the DB powers user rules.
- Extraction logic is limited to what `transform` supports. Complex formats may need new transform options in code.

## Alternatives
- Rules as TypeScript code: rejected because it isn't data, can't be created at runtime, and makes contributions harder.
- Grok patterns: weak JS support, adds a layer over plain regex.
- Sigma/Falco-style rules: built for detection, no field extraction.
- json-rules-engine: good for logic, but regex needs a custom operator and there is no extraction.
