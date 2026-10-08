# MacroDroid

Forwards bank notifications to `POST /api/ingest` (SPEC §4.1, §13.4).

## Setup

1. Import `denarii.macro` into MacroDroid, or build the macro by hand:
   - **Trigger:** Notification Received, from the banking apps (Galicia, Mercado Pago).
   - **Action:** HTTP Request, method `POST`, URL `<PUBLIC_URL>/api/ingest`.
     - Header `X-Webhook-Secret: <WEBHOOK_SECRET>`.
     - Query parameters, each inserted with the magic text picker:
       - `app`: notification app name
       - `title`: notification title
       - `text`: notification text
       - `received_at`: system time in milliseconds
     - No body.
2. Replace `<PUBLIC_URL>` and `<WEBHOOK_SECRET>`. `just rotate-webhook-secret` prints a new secret.
3. Exclude MacroDroid from battery optimization so it keeps running.

Use query parameters, not a JSON body: MacroDroid URL-encodes query parameters but inserts magic text into a body unescaped, so a quote or newline in a notification makes the JSON invalid and the event is lost.

## Exporting

Before committing an export, replace the URL and secret with `<PUBLIC_URL>` and `<WEBHOOK_SECRET>`. The repo is public.
