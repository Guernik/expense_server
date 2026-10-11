export interface PollingOptions {
  token: string;
  /** Handles one Telegram `Update`. A failure is logged and the update is not redelivered. */
  onUpdate(update: unknown): Promise<void>;
  /** Stops polling, also mid-request. */
  signal: AbortSignal;
  fetch?: typeof fetch;
  /** Long-poll timeout passed to `getUpdates`. */
  timeoutSeconds?: number;
  /** Wait after a failed `getUpdates` before retrying. */
  retryMs?: number;
}

interface TelegramResponse<T> {
  ok: boolean;
  description?: string;
  result?: T;
}

/**
 * Receives bot updates with `getUpdates` long polling (`TELEGRAM_MODE=polling`, SPEC §13.3), so no
 * public URL is needed. Resolves when `signal` aborts. Refuses to start if the bot has a webhook,
 * since Telegram rejects `getUpdates` then and deleting it would break the instance using it.
 */
export async function pollTelegram(options: PollingOptions): Promise<void> {
  const { token, onUpdate, signal, timeoutSeconds = 50, retryMs = 5000 } = options;
  const fetchFn = options.fetch ?? fetch;

  async function call<T>(method: string, params: object): Promise<T> {
    const response = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
      signal,
    });
    const body = (await response.json()) as TelegramResponse<T>;
    if (!body.ok || body.result === undefined) {
      throw new Error(`Telegram ${method} failed (${response.status}): ${body.description ?? ""}`);
    }
    return body.result;
  }

  const webhook = await call<{ url: string }>("getWebhookInfo", {});
  if (webhook.url) {
    throw new Error(
      `The bot has a webhook (${webhook.url}). Remove it with deleteWebhook to use ` +
        "TELEGRAM_MODE=polling, or set TELEGRAM_MODE=webhook.",
    );
  }

  let offset = 0;
  while (!signal.aborted) {
    let updates: { update_id: number }[];
    try {
      updates = await call("getUpdates", {
        offset,
        timeout: timeoutSeconds,
        allowed_updates: ["message", "callback_query"],
      });
    } catch (error) {
      if (signal.aborted) break;
      console.error("Telegram getUpdates failed, retrying", error);
      await sleep(retryMs, signal);
      continue;
    }
    for (const update of updates) {
      try {
        await onUpdate(update);
      } catch (error) {
        console.error(`Telegram update ${update.update_id} failed`, error);
      }
      offset = update.update_id + 1;
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
