# Operational tasks for the Cloudflare deployment. Secrets go to the deployed Worker
# (`wrangler secret put`) and to apps/cloudflare/.dev.vars, which is assumed to hold the
# same values as production.

worker := "apps/cloudflare"
dev_vars := worker / ".dev.vars"

# List recipes
default:
    @just --list

# Rotate WEBHOOK_SECRET (MacroDroid -> /api/ingest). Update MacroDroid with the printed value.
rotate-webhook-secret:
    #!/usr/bin/env bash
    set -euo pipefail
    new=$(openssl rand -hex 32)
    just _put-secret WEBHOOK_SECRET "$new"
    echo "New WEBHOOK_SECRET, set it as the X-Webhook-Secret header in MacroDroid:"
    echo "$new"

# Rotate TELEGRAM_WEBHOOK_SECRET (Telegram -> /api/telegram) and re-register the webhook
rotate-telegram-webhook-secret:
    #!/usr/bin/env bash
    set -euo pipefail
    token=$(just _dev-var TELEGRAM_BOT_TOKEN)
    url=$(just _webhook-url "$token")
    new=$(openssl rand -hex 32)
    just _put-secret TELEGRAM_WEBHOOK_SECRET "$new"
    just _set-webhook "$token" "$url" "$new"

# Rotate TELEGRAM_BOT_TOKEN: prompts for the token from @BotFather /revoke, re-registers the webhook
rotate-telegram-bot-token:
    #!/usr/bin/env bash
    set -euo pipefail
    url=$(just _webhook-url "$(just _dev-var TELEGRAM_BOT_TOKEN)")
    echo "Webhook URL: $url"
    echo "In @BotFather: /revoke, pick the bot, then paste the new token here."
    read -rsp "New token: " token
    echo
    [[ -n "$token" ]] || { echo "No token given" >&2; exit 1; }
    just _put-secret TELEGRAM_BOT_TOKEN "$token"
    just _set-webhook "$token" "$url" "$(just _dev-var TELEGRAM_WEBHOOK_SECRET)"

# Send a notification to /api/ingest. Targets the deployed Worker unless DENARII_URL is set (e.g. http://localhost:8787)
[positional-arguments]
ingest app title text:
    #!/usr/bin/env bash
    set -euo pipefail
    base=${DENARII_URL:-$(just _webhook-url "$(just _dev-var TELEGRAM_BOT_TOKEN)")}
    base=${base%/api/telegram}
    jq -nc --arg app "$1" --arg title "$2" --arg text "$3" '{$app, $title, $text}' \
      | curl -sS "$base/api/ingest" -H "X-Webhook-Secret: $(just _dev-var WEBHOOK_SECRET)" \
          -H 'Content-Type: application/json' --data-binary @-
    echo

# Print the current Telegram webhook status
webhook-info:
    @curl -fsS "https://api.telegram.org/bot$(just _dev-var TELEGRAM_BOT_TOKEN)/getWebhookInfo" | jq .result

[private]
_dev-var name:
    #!/usr/bin/env bash
    set -euo pipefail
    value=$(grep -E '^{{ name }}=' "{{ dev_vars }}" | cut -d= -f2-) || true
    [[ -n "$value" ]] || { echo "{{ name }} missing from {{ dev_vars }}" >&2; exit 1; }
    echo "$value"

# Sets a secret on the deployed Worker, then in .dev.vars
[private]
_put-secret name value:
    #!/usr/bin/env bash
    set -euo pipefail
    printf '%s' "{{ value }}" | npx wrangler secret put "{{ name }}" --cwd "{{ worker }}"
    tmp=$(mktemp)
    awk -v k="{{ name }}" -v v="{{ value }}" '
      index($0, k "=") == 1 { print k "=" v; done = 1; next }
      { print }
      END { if (!done) print k "=" v }
    ' "{{ dev_vars }}" > "$tmp"
    mv "$tmp" "{{ dev_vars }}"
    echo "Updated {{ name }} in the Worker and {{ dev_vars }}"

[private]
_webhook-url token:
    #!/usr/bin/env bash
    set -euo pipefail
    url=$(curl -fsS "https://api.telegram.org/bot{{ token }}/getWebhookInfo" | jq -r .result.url)
    [[ -n "$url" ]] || { echo "No Telegram webhook registered" >&2; exit 1; }
    echo "$url"

[private]
_set-webhook token url secret:
    #!/usr/bin/env bash
    set -euo pipefail
    curl -fsS "https://api.telegram.org/bot{{ token }}/setWebhook" \
      --data-urlencode "url={{ url }}" --data-urlencode "secret_token={{ secret }}" | jq -e .ok > /dev/null
    curl -fsS "https://api.telegram.org/bot{{ token }}/getWebhookInfo" \
      | jq '.result | {url, pending_update_count, last_error_message}'
