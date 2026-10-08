# denarii - Product Spec

> Codename: **denarii**. License: MIT. Open source, self-installable.
> Reference instance: `https://denarii.emilioguernik.com` (Cloudflare).

## 1. Summary

denarii collects card and wallet payment notifications from an Android phone, turns them into categorized expenses, and asks the user via Telegram whenever it can't decide something on its own. A web dashboard shows spending summaries.

```
Phone notification
  -> MacroDroid HTTP POST
  -> denarii ingest
  -> classifier (regex rules: purchase / transfer / ignore / unmatched)
  -> dedupe
  -> categorizer (merchant rule -> LLM suggestion -> user via Telegram)
  -> storage
  -> dashboard
```

## 2. Goals and non-goals

**Goals**
- Capture every purchase notification with zero manual entry.
- Categorize automatically when possible. Otherwise reach a decision in one Telegram tap.
- Deterministic purchase detection: **only regex rules decide what is a purchase**, never an LLM.
- Anyone can install it: Cloudflare (default) or self-hosted with Docker.
- Rules for new banks/countries can be contributed as data files with tests.

**Non-goals (for now)**
- Currency conversion.
- Bank API / statement integrations.
- Budgets, forecasting, alerts.
- iOS or anything other than MacroDroid as the notification source. The ingest API is generic, though.

## 3. Domain model

| Concept | Definition |
|---|---|
| **Event** | One raw notification received from MacroDroid (`app`, `title`, `text`, `received_at`). Always stored. |
| **Classifier rule** | A regex rule that matches events and assigns a kind (`purchase`, `transfer`, `ignore`), and optionally extracts fields. |
| **Rule pack** | A bundled YAML file of classifier rules for one provider (e.g. `ar.galicia`). |
| **User rule** | A classifier rule created at runtime (e.g. "Ignore similar"), stored in the DB. Evaluated before packs. |
| **Purchase** | An expense derived from one or more events. Has amount, currency, merchant, payment method, occurred time, category, and comment. Transfers are purchases with `kind = transfer`. |
| **Payment method** | Where the money came from, e.g. `Galicia Visa Crédito 3551` or `Mercado Pago cuenta`. Created automatically the first time it is seen. |
| **Category** | Exactly one per purchase, e.g. `Delivery`. |
| **Group** | Exactly one per category, e.g. `Food`. A purchase's group is **always derived** from its category, so reassigning a category's group updates every total. |
| **Merchant rule** | Exact mapping from a normalized merchant to a category. Created automatically when the user categorizes a purchase. |

Example: ordering food gives `Category: Delivery`, `Group: Food`.

## 4. Ingest

### 4.1 Endpoint

`POST /api/ingest`

Headers: `X-Webhook-Secret: <WEBHOOK_SECRET>` (constant-time compare, `401` on mismatch).

Body (JSON):
```json
{
  "app": "Galicia",
  "title": "Pagaste $15.000,01",
  "text": "A AXION VILLA ALLENDE con tu Visa Crédito 3551 a las 22:32.",
  "received_at": "2026-10-05T22:32:10-03:00"
}
```

- `app`: originating app name (MacroDroid `[notification_app_name]`). Informational only. Rules may use it, but title and text are what drive classification.
- `received_at`: optional. Defaults to server receive time.
- The endpoint stores the event and returns `202` right away. Processing runs async (`ctx.waitUntil` on Cloudflare, in-process queue on Node).

### 4.2 Text normalization (before matching)

- Decode HTML entities (`&#x3D;` -> `=`).
- Normalize Unicode (NFC), collapse whitespace, trim.
- Strip a trailing `.` from `text`.

## 5. Classifier

### 5.1 Pipeline

1. Load the active rules: **user rules first**, then the enabled packs (`RULE_PACKS`), each list sorted by `priority` descending.
2. The first rule whose `match` patterns all match wins.
3. Outcome by kind:
   - `purchase`: extract fields, then go to dedupe and categorization.
   - `transfer`: extract fields, then go to dedupe and the transfer flow (§7.4).
   - `ignore`: event marked `ignored`. Done.
   - no match: event marked `unmatched`, then the unmatched flow (§7.3).

The LLM is **never** consulted to decide whether an event is a purchase.

### 5.2 Rule format

Rules are YAML using named regex capture groups. They are validated by a Zod schema, which is also exported as a JSON Schema so editors can autocomplete. User rules use the same schema and are stored as JSON.

```yaml
# rules/ar/galicia.yaml
pack: ar.galicia
rules:
  - id: ar.galicia.card-bill-payment
    kind: ignore
    priority: 200
    match:
      title: '^Pagaste tu tarjeta'
    tests:
      - title: 'Pagaste tu tarjeta VISA✅'
        text: 'Se debitaron $35.239,92 de tu cuenta.'

  - id: ar.galicia.card-purchase
    kind: purchase
    priority: 100
    match:
      title: '^Pagaste:? (?<currency>\$|USD) ?(?<amount>[\d.,]+)$'
      text: '^A (?<merchant>.+?) con tu (?<method>.+?):? (?<last4>\d{4}) a las (?<time>\d{2}:\d{2})$'
    transform:
      amount: { number_format: es-AR }
      currency: { map: { "$": ARS, USD: USD } }
      payment_method: 'Galicia {method} {last4}'
    tests:
      - title: 'Pagaste $15.000,01'
        text: 'A AXION VILLA ALLENDE con tu Visa Crédito 3551 a las 22:32.'
        expect: { amount: "15000.01", currency: ARS, merchant: AXION VILLA ALLENDE, payment_method: Galicia Visa Crédito 3551, time: "22:32" }
      - title: 'Pagaste USD20'
        text: 'A ANTRHOPIC* CLAUDE SUB con tu Visa Crédito: 3440 a las 18:17'
        expect: { amount: "20", currency: USD, merchant: ANTRHOPIC* CLAUDE SUB, payment_method: Galicia Visa Crédito 3440, time: "18:17" }
```

Schema:

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Globally unique, `<pack>.<slug>`. User rules: `user.<uuid>`. |
| `kind` | yes | `purchase` \| `transfer` \| `ignore` |
| `priority` | no | Default `0`. Higher runs first within its source. |
| `match.title` / `match.text` / `match.app` | at least one | JS regex (`u` flag). All present patterns must match. |
| Named groups | `purchase`/`transfer` need `amount` | Recognized: `amount`, `currency`, `merchant`, `method`, `last4`, `time`. Any other names can be used in templates. |
| `transform.amount.number_format` | no | `es-AR` (`.` thousands, `,` decimals) \| `en-US` \| `plain` |
| `transform.currency.map` | no | Maps the captured token to an ISO code. `transform.currency.default` is used when nothing is captured. |
| `transform.payment_method` | no | Template using `{group}` placeholders, or a literal (e.g. `Mercado Pago cuenta`). |
| `transform.merchant` | no | Literal override (e.g. `Unknown`). |
| `tests` | yes for packs | Each test has `title`, `text`, optional `app`, optional `expect` (extracted fields) or `expect_kind`. Run in CI. |

Every pack rule needs at least one test. CI also replays a shared fixture corpus (anonymized real notifications) and fails if any classification changes without the fixture being updated.

### 5.3 Initial packs

Based on real notification logs:

**`ar.galicia`**
| Title pattern | Kind |
|---|---|
| `Pagaste $N` + `A <m> con tu Visa Crédito[:] NNNN a las HH:MM` | purchase |
| `Pagaste: $N` + `A <m> con tu Amex NNNN a las HH:MM` | purchase |
| `Pagaste USD[ ]N` + same text as above | purchase (USD) |
| `Transferiste: $N` | transfer |
| `Pagaste tu tarjeta …` | ignore |
| `Rechazamos tu pago …`, `Rechazo por seguridad`, `Límite insuficiente` | ignore |
| `Ahorraste: $N` | ignore |
| `¿Estás intentando pagar …?` | ignore |
| `Cerró tu Visa`, `Tu tarjeta … vence hoy` | ignore |

**`ar.mercadopago`**
| Title pattern | Kind |
|---|---|
| `Pagaste a <merchant>` + `Debitamos $ N de tu cuenta` | purchase, method `Mercado Pago cuenta` |
| `Tu pago fue aprobado` + `Hiciste un pago por $ N` | purchase, merchant `Unknown` (always prompts, no merchant rule) |
| `… vence pronto`, `Tenés una factura que vence …` | ignore |
| `Recibiste …`, `¡Recibiste plata!`, `Tu dinero ya está disponible` | ignore (income is out of scope) |
| `Hubo un problema con tu pago`, `No tienes dinero suficiente` | ignore |

Promotional notifications aren't enumerated. They fall to `unmatched`, and the user silences them with "Ignore similar" (§7.3), which builds up user rules.

### 5.4 Field extraction

- **Amount**: parsed according to `number_format` and stored as integer minor units (`amount_minor`) plus `currency`. Supported currencies: `ARS`, `USD`. No conversion.
- **Occurred at**: the extracted `time` combined with the date of `received_at` in `TIMEZONE`. If the time is later than `received_at` (a notification just after midnight), use the previous day. Without `time`, `occurred_at = received_at`.
- **Merchant normalization** (`merchant_normalized`, used for rules and dedupe display):
  1. Decode entities, NFC, uppercase, trim, collapse spaces.
  2. Strip processor prefixes: `MERPAGO=`, `DLO*` (the list is configurable per pack via `transform.strip_prefixes`).
  3. Keep everything else, e.g. `GOOGLE *GOOGLE ONE` stays as is.
  The raw merchant is kept too (`merchant_raw`).
- **Payment method**: upserted by label per user.

## 6. Dedupe

After classification as `purchase` or `transfer`:

- Look for an existing purchase of the same user with the same `amount_minor` and `currency` whose source event's (`purchases.source_event_id`) `received_at` is within **±30 seconds**. The check and insert are one statement, so concurrent duplicates can't both create a purchase.
- If one exists, link the new event to it (`events.purchase_id`), mark the event `duplicate`, and keep the richer extraction (more non-null fields wins; payment method and merchant from a card notification beat wallet ones). No new Telegram prompt.
- Anything outside 30 seconds is a new purchase.

## 7. Categorization and Telegram

### 7.1 Categorizer order

1. **Merchant rule**: exact match on `merchant_normalized`, giving the category. Purchase becomes `categorized` (`categorized_by = rule`). Telegram sends a confirmation (§7.2a).
2. **LLM suggestion** (if a provider is configured): the prompt includes the merchant, amount, payment method, the full category list with groups, and the last ~20 user-categorized purchases as examples. Output (structured): `{ category_id | new_category_name, group_id | new_group_name }`. Stored as `suggested_category`. Never applied without the user.
3. **Telegram prompt** (§7.2b). Purchase stays `pending` until answered.

Merchant `Unknown` skips step 1 and never creates a merchant rule.

### 7.2 Messages

All bot text is i18n (`en`, `es`, chosen by `LOCALE`). Telegram `callback_data` is kept under 64 bytes using short opaque IDs.

**a) Rule match confirmation**
```
✅ $15.000,01 ARS · AXION VILLA ALLENDE
Fuel (Transport) · Galicia Visa Crédito 3551 · 22:32
[Change]
```
`Change` opens the picker (b). The new choice replaces the purchase's category **and** updates the merchant rule.

**b) Category picker** (no rule matched)
```
🛒 $10.200,00 ARS · SHOWCASE CORDOBA
Mercado Pago cuenta · 14:05
[✨ Cinema (Leisure)]               <- LLM suggestion, if any
[Groceries] [Delivery] [Fuel]
[Restaurants] [Pharmacy] [Coffee]  <- top 6 by use in last 90 days
[More…] [➕ New category]
[🚫 Not a purchase] [Skip]
```
- Picking a category sets it, marks the purchase `categorized`, and **creates/updates the merchant rule** automatically.
- `More…` paginates all categories, grouped.
- `➕ New category`: bot asks for the name (free text), then shows group buttons plus `➕ New group` (free text). Creates them, then applies them as above.
- `🚫 Not a purchase`: marks the purchase `excluded` (kept, not counted), then offers `🔇 Ignore similar` (§7.3).
- `Skip`: leaves it `pending`.
- **Comment**: replying to any purchase message with text sets or overwrites that purchase's comment. The bot reacts ✅.

### 7.3 Unmatched events

```
❓ Unrecognized notification (Galicia)
"Tu nuevo look, con promo💈✂️"
"Miércoles y jueves ahorrá 25% con MODO…"
[💳 PURCHASE] [🚫 NON-PURCHASE]
```

- **NON-PURCHASE**: event marked `non_purchase`. The bot offers `🔇 Ignore similar`, which generates a user rule:
  - `kind: ignore`, `match.title` = the escaped title anchored `^…$`, with every number run generalized to `[\d.,]+`.
  - The bot shows the regex. `[Confirm]` saves it, `[Cancel]` discards it.
- **PURCHASE**:
  1. **Extraction**: if an LLM is configured, it extracts `amount`, `currency`, `merchant`, `payment_method`, `time` from title+text. The bot shows them with `[✅ Correct] [✏️ Edit]`. With no LLM, on failure, or on `Edit`, the bot asks the user to type `<amount> <merchant>` (e.g. `15000,50 Axion`). Currency defaults to ARS unless `USD` is typed.
  2. **Rule proposal** (LLM only): the LLM proposes a `purchase` rule with named groups. The server **validates** it against the event: it must compile, match, and reproduce the confirmed fields. If valid, the bot shows it with `[Save rule] [No]`. Invalid proposals are dropped silently.
  3. Then dedupe and the normal category flow (§7.1).

### 7.4 Transfers

```
↗️ Transfer $300.000 ARS
[💸 Expense] [↔️ Not an expense]
```
- **Expense**: bot asks for a description (free text, becomes the merchant), then shows the category picker. **No merchant rule** is created for transfers.
- **Not an expense** (own account, investment, …): marked `excluded`.

### 7.5 Commands

| Command | Action |
|---|---|
| `/pending` | Re-sends prompts for all `pending` purchases and transfers (oldest first, max 10). |
| `/setgroup <category> <group>` | Moves a category to a group (creates the group if missing). Totals update automatically since the group is derived. |
| `/help` | Lists commands. |

### 7.6 Daily digest (cron, `DIGEST_CRON`, default 21:00 local)

Sent only when there's something to report:
- Count of `pending` purchases.
- Events marked `excluded` / `non_purchase` in the last 24h without an ignore rule (possible classifier misses).
- Any `unmatched` events not answered.

### 7.7 Security

- The bot only responds to `TELEGRAM_CHAT_ID`. Everything else is ignored.
- Webhook mode: Telegram `secret_token` checked against `TELEGRAM_WEBHOOK_SECRET`.

## 8. Dashboard (web)

React SPA. Authenticated with **Better Auth** using the Google provider. Sign-in is allowed only for emails in `ALLOWED_EMAILS` (comma-separated).

**v1 (read-only)**
- Month selector (default: current month, in `TIMEZONE`).
- Totals tree: group -> category, with **ARS and USD in separate columns** (no conversion). Excludes `excluded` and `pending` purchases. Pending is shown as its own row.
- Recent purchases table: date/time, merchant, amount, currency, payment method, category, group, comment, status.
- Filter by payment method.
- Pending count badge.

**v2**
- Re-categorize purchases, edit comments, change a category's group.
- Manage categories, groups, merchant rules, and user classifier rules (with a live regex tester against stored events).
- Browse `events` (audit, including ignored/unmatched).
- Confirm batch LLM suggestions for uncategorized history.

## 9. Data model

SQLite dialect (D1 on Cloudflare, `better-sqlite3` on Node), defined with Drizzle. Every domain table has `user_id` (one user in v1, multi-user ready). Timestamps are UTC ISO strings.

```
users              id, email, telegram_chat_id, locale, timezone, created_at
events             id, user_id, app, title, text, received_at, created_at,
                   status (purchase|transfer|ignored|unmatched|non_purchase|duplicate),
                   rule_id, rule_source (pack|user), purchase_id?, extracted_by (regex|llm|user)
purchases          id, user_id, kind (purchase|transfer), status (pending|categorized|excluded),
                   occurred_at, amount_minor, currency, merchant_raw, merchant_normalized,
                   payment_method_id?, category_id?, comment?, suggested_category_id?,
                   categorized_by (rule|user|import)?, source (live|import),
                   telegram_message_id?, source_event_id?, created_at, updated_at
payment_methods    id, user_id, label                        UNIQUE(user_id, label)
groups             id, user_id, name                         UNIQUE(user_id, name)
categories         id, user_id, name, group_id               UNIQUE(user_id, name)
merchant_rules     id, user_id, merchant_normalized, category_id, source (user|import), updated_at
                                                             UNIQUE(user_id, merchant_normalized)
classifier_rules   id, user_id, definition (JSON, rule schema), enabled, created_from_event_id?, created_at
chat_state         chat_id, state (JSON: awaiting_category_name | awaiting_group_name |
                   awaiting_manual_extraction | awaiting_transfer_description, + context), expires_at
(+ Better Auth tables: user/session/account/verification)
```

The group is never stored on purchases. Totals join `purchases -> categories -> groups`.

## 10. Backfill import

One-off CLI: `denarii import <file.json|file.csv>`. It runs against the configured store (local D1 via wrangler, or the SQLite file).

```json
[
  { "date": "2026-09-14", "time": "22:32", "merchant": "AXION VILLA ALLENDE",
    "amount": "15000.01", "currency": "ARS", "payment_method": "Galicia Visa Crédito 3551",
    "category": "Fuel", "group": "Transport", "comment": null }
]
```

- `time` and `comment` are optional. CSV has the same columns.
- `amount` uses `.` as the decimal separator.
- Creates the groups, categories, and payment methods it finds. This is the **seed taxonomy**.
- Purchases are inserted as `categorized`, `source = import`. No Telegram messages.
- Merchant rules: for each normalized merchant, the most frequent category, but only if that merchant has a single category in the file. Merchants with mixed categories get no rule.
- Idempotent: re-importing skips rows that match an existing import on (date, merchant_normalized, amount_minor, currency).

## 11. LLM providers

Optional. `LLM_PROVIDER = anthropic | openai | workers-ai | none` (default `none`).

| Provider | Default model | Config |
|---|---|---|
| `anthropic` | `claude-haiku-4-5` | `ANTHROPIC_API_KEY` |
| `openai` | configurable | `OPENAI_API_KEY`, `OPENAI_BASE_URL` (OpenAI-compatible endpoints) |
| `workers-ai` | configurable | Cloudflare `AI` binding, or `CF_ACCOUNT_ID` + `CF_API_TOKEN` on Node |

`LLM_MODEL` overrides the default. All providers implement one interface with three structured-output operations:
- `suggestCategory`
- `extractPurchase`
- `proposeRule`

Calls time out at 10s. Any failure degrades to the no-LLM path.

## 12. Architecture

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/architecture-dark.png">
  <img alt="denarii architecture" src="docs/diagrams/architecture-light.png">
</picture>

Nx + npm workspaces.

```
packages/
  core/        classifier engine, rule schema, parsers, normalization, dedupe,
               categorizer, Telegram conversation flows, i18n.
               Pure TS, depends only on interfaces: Store, LlmProvider, Messenger, Clock, Scheduler
  db/          Drizzle schema, migrations, Store implementation (SQLite dialect)
  llm/         Anthropic, OpenAI, Workers AI providers
  api/         Hono app: /api/ingest, /api/telegram, /api/auth/*, /api/trpc/*
  cli/         setup, import, rules:test
apps/
  web/         React SPA (Vite, TanStack Router + Query, Tailwind, shadcn/ui, tRPC client)
  cloudflare/  Worker entry: D1 binding, Cron Triggers, static assets, waitUntil
  node/        Node entry: better-sqlite3, node-cron, serves SPA, Telegram polling|webhook
rules/
  ar/galicia.yaml
  ar/mercadopago.yaml
  schema.json  (generated)
fixtures/      anonymized notification corpus for regression tests
macrodroid/    exported .macro file
docker/        Dockerfile, docker-compose.yml
```

- **API**: the MacroDroid and Telegram webhooks are plain Hono routes. The dashboard uses tRPC (`purchases.list`, `summary.byMonth`, `categories.list`, `paymentMethods.list`, … ; v2 adds mutations).
- **Testing**: Vitest. Pack rule `tests` plus the fixture corpus run in CI. Core logic is tested against an in-memory SQLite Store.
- **CI**: GitHub Actions, `nx affected` lint/typecheck/test. On tags it builds and pushes the image to GHCR.
- **CD**: after CI passes on `main`, records a D1 Time Travel bookmark, applies D1 migrations and deploys the Worker.

## 13. Deployment and configuration

### 13.1 Environment

| Var | Required | Notes |
|---|---|---|
| `WEBHOOK_SECRET` | yes | MacroDroid header secret |
| `TELEGRAM_BOT_TOKEN` | yes | |
| `TELEGRAM_CHAT_ID` | yes | The only chat the bot talks to |
| `TELEGRAM_MODE` | no | `webhook` (Cloudflare, only option) \| `polling` (Node default) |
| `TELEGRAM_WEBHOOK_SECRET` | webhook mode | |
| `PUBLIC_URL` | yes | e.g. `https://denarii.emilioguernik.com` |
| `ALLOWED_EMAILS` | yes | Comma-separated |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | yes | Better Auth Google provider |
| `BETTER_AUTH_SECRET` | yes | |
| `RULE_PACKS` | yes | e.g. `ar.galicia,ar.mercadopago` |
| `TIMEZONE` | no | Default `America/Argentina/Cordoba` |
| `LOCALE` | no | `en` \| `es`, default `en` |
| `DIGEST_CRON` | no | Default `0 21 * * *` (local) |
| `LLM_PROVIDER`, `LLM_MODEL`, provider keys | no | §11 |
| `DATABASE_PATH` | Node only | Default `/data/denarii.db` |

### 13.2 Cloudflare (default, reference instance)

- Worker on custom domain `denarii.emilioguernik.com`, D1 database, Cron Trigger for the digest, static assets for the SPA, optional `AI` binding.
- "Deploy to Cloudflare" button in the README.
- `denarii setup` CLI: creates D1, applies migrations, sets secrets, registers the Telegram webhook, prints the MacroDroid URL and secret.

### 13.3 Self-hosted (Docker)

- `docker-compose.yml`:
  - `denarii` service: image from GHCR, `build:` fallback, `.env` file, named volume for `/data`, runs migrations on start.
  - `cloudflared` service under compose profile `tunnel` (**off by default**) to expose a public HTTPS URL for MacroDroid (and Telegram webhooks, if used).
- Telegram defaults to polling, so no public URL is needed for the bot. MacroDroid still needs a reachable URL (tunnel, Tailscale Funnel, or own reverse proxy).

### 13.4 MacroDroid

The repo ships an exported macro:
- Trigger: notification received from the configured banking apps.
- Action: HTTP POST to `<PUBLIC_URL>/api/ingest` with the secret header and JSON body `{app: [notification_app_name], title: [notification_title], text: [notification], received_at: [system_time]}`.

## 14. Phases

**MVP (today, 2026-10-05)**
- Ingest endpoint, event storage.
- Classifier engine, rule schema, `ar.galicia` + `ar.mercadopago` packs with tests and fixtures.
- Dedupe, merchant normalization, payment methods.
- Merchant rules, LLM suggestion (at least the Anthropic provider), Telegram flows §7.2-7.5, user rules from "Ignore similar".
- Backfill import CLI.
- Cloudflare deployment at `denarii.emilioguernik.com`.

**Next**
- Dashboard v1 + Better Auth.
- Daily digest.
- OpenAI and Workers AI providers.
- Node runtime, Docker compose, GHCR publishing, setup CLI, exported macro, README.

**v2**
- Dashboard editing and config (§8 v2).
- Multi-user: per-user Telegram chat and settings, onboarding.
- Rule editing UI with regex tester.
- Batch LLM categorization of uncategorized history.
- Refund handling (negative amounts) once real refund notifications are observed.

## 15. Open items

- **Seed taxonomy**: comes from the user's September backfill file.
- **Final project name**: `denarii` is a codename.
- **Refund notification formats**: none observed yet. Handled by the unmatched flow until a pack rule exists.
