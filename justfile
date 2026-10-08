# Local development and operational tasks for the Cloudflare deployment (ADR-0013).
# Local uses a separate dev bot whose secrets live in apps/cloudflare/.dev.vars. Production
# secrets go to the deployed Worker (`wrangler secret put`) and to apps/cloudflare/.prod.vars.
# Both files are git-ignored.

worker := "apps/cloudflare"
dev_vars := worker / ".dev.vars"
prod_vars := worker / ".prod.vars"
local_port := "8787"
local_url := "http://localhost:" + local_port

# List recipes
default:
    @just --list

# Run the Worker locally with the dev bot: applies local migrations, starts `wrangler dev` and forwards dev bot updates to it
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    if lsof -nP -iTCP:{{ local_port }} -sTCP:LISTEN > /dev/null; then
      echo "Port {{ local_port }} is in use, stop the other local Worker first" >&2
      exit 1
    fi
    npm run migrate:local -w @denarii/cloudflare
    npm run dev -w @denarii/cloudflare -- --port {{ local_port }} &
    worker_pid=$!
    trap 'kill 0' EXIT
    until curl -s -o /dev/null "{{ local_url }}"; do
      kill -0 $worker_pid 2>/dev/null || exit 1
      sleep 1
    done
    just local_port={{ local_port }} telegram-poll

# Long-poll the dev bot and forward each update to the local Worker's /api/telegram
telegram-poll:
    #!/usr/bin/env bash
    set -euo pipefail
    token=$(just _var "{{ dev_vars }}" TELEGRAM_BOT_TOKEN)
    secret=$(just _var "{{ dev_vars }}" TELEGRAM_WEBHOOK_SECRET)
    api="https://api.telegram.org/bot$token"
    webhook=$(curl -fsS "$api/getWebhookInfo" | jq -r .result.url)
    if [[ -n "$webhook" ]]; then
      echo "The bot in {{ dev_vars }} has a webhook ($webhook). Use a dev bot without one." >&2
      exit 1
    fi
    echo "Forwarding dev bot updates to {{ local_url }}/api/telegram"
    offset=0
    while true; do
      updates=$(curl -fsS "$api/getUpdates?timeout=50&offset=$offset") || { sleep 5; continue; }
      while read -r update; do
        until curl -fsS -o /dev/null "{{ local_url }}/api/telegram" \
            -H "X-Telegram-Bot-Api-Secret-Token: $secret" \
            -H 'Content-Type: application/json' --data-binary "$update"; do
          echo "Forward failed, retrying" >&2
          sleep 2
        done
        offset=$(( $(jq -r .update_id <<< "$update") + 1 ))
      done < <(jq -c '.result[]' <<< "$updates")
    done

# Send a notification to the local Worker's /api/ingest
[positional-arguments]
ingest app title text:
    @just _ingest "{{ local_url }}" "$(just _var {{ dev_vars }} WEBHOOK_SECRET)" "$1" "$2" "$3"

# Send a notification to the deployed Worker's /api/ingest
[positional-arguments]
ingest-prod app title text:
    #!/usr/bin/env bash
    set -euo pipefail
    url=$(just _webhook-url "$(just _var {{ prod_vars }} TELEGRAM_BOT_TOKEN)")
    just _ingest "${url%/api/telegram}" "$(just _var {{ prod_vars }} WEBHOOK_SECRET)" "$1" "$2" "$3"

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
    token=$(just _var "{{ prod_vars }}" TELEGRAM_BOT_TOKEN)
    url=$(just _webhook-url "$token")
    new=$(openssl rand -hex 32)
    just _put-secret TELEGRAM_WEBHOOK_SECRET "$new"
    just _set-webhook "$token" "$url" "$new"

# Rotate TELEGRAM_BOT_TOKEN: prompts for the token from @BotFather /revoke, re-registers the webhook
rotate-telegram-bot-token:
    #!/usr/bin/env bash
    set -euo pipefail
    url=$(just _webhook-url "$(just _var "{{ prod_vars }}" TELEGRAM_BOT_TOKEN)")
    echo "Webhook URL: $url"
    echo "In @BotFather: /revoke, pick the bot, then paste the new token here."
    read -rsp "New token: " token
    echo
    [[ -n "$token" ]] || { echo "No token given" >&2; exit 1; }
    just _put-secret TELEGRAM_BOT_TOKEN "$token"
    just _set-webhook "$token" "$url" "$(just _var "{{ prod_vars }}" TELEGRAM_WEBHOOK_SECRET)"

# Print the production Telegram webhook status
webhook-info:
    @curl -fsS "https://api.telegram.org/bot$(just _var {{ prod_vars }} TELEGRAM_BOT_TOKEN)/getWebhookInfo" | jq .result

[private]
_var file name:
    #!/usr/bin/env bash
    set -euo pipefail
    value=$(grep -E '^{{ name }}=' "{{ file }}" | cut -d= -f2-) || true
    [[ -n "$value" ]] || { echo "{{ name }} missing from {{ file }}" >&2; exit 1; }
    echo "$value"

[private]
[positional-arguments]
_ingest base secret app title text:
    #!/usr/bin/env bash
    set -euo pipefail
    jq -nc --arg app "$3" --arg title "$4" --arg text "$5" '{$app, $title, $text}' \
      | curl -sS "$1/api/ingest" -H "X-Webhook-Secret: $2" \
          -H 'Content-Type: application/json' --data-binary @-
    echo

# Sets a secret on the deployed Worker, then in .prod.vars
[private]
_put-secret name value:
    #!/usr/bin/env bash
    set -euo pipefail
    printf '%s' "{{ value }}" | npx wrangler secret put "{{ name }}" --cwd "{{ worker }}"
    tmp=$(mktemp)
    touch "{{ prod_vars }}"
    awk -v k="{{ name }}" -v v="{{ value }}" '
      index($0, k "=") == 1 { print k "=" v; done = 1; next }
      { print }
      END { if (!done) print k "=" v }
    ' "{{ prod_vars }}" > "$tmp"
    mv "$tmp" "{{ prod_vars }}"
    echo "Updated {{ name }} in the Worker and {{ prod_vars }}"

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
