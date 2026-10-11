/**
 * A fake Telegram Bot API for tests: serves queued updates to `getUpdates` (blocking until one is
 * queued or the request is aborted, like a long poll) and records every other call.
 */
export function createFakeTelegram(options: { webhookUrl?: string } = {}) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const queue: object[] = [];
  let nextUpdateId = 1;
  let wake: (() => void) | undefined;
  let nextMessageId = 500;

  const reply = (result: unknown) =>
    new Response(JSON.stringify({ ok: true, result }), {
      headers: { "content-type": "application/json" },
    });

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const method = String(input).split("/").at(-1) ?? "";
    const params = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ method, params });
    switch (method) {
      case "getWebhookInfo":
        return reply({ url: options.webhookUrl ?? "" });
      case "getUpdates": {
        const offset = Number(params.offset ?? 0);
        const signal = init?.signal;
        while (!queue.some((u) => (u as { update_id: number }).update_id >= offset)) {
          if (signal?.aborted) throw new DOMException("aborted", "AbortError");
          await new Promise<void>((resolve) => {
            wake = resolve;
            signal?.addEventListener("abort", () => resolve(), { once: true });
          });
        }
        return reply(queue.filter((u) => (u as { update_id: number }).update_id >= offset));
      }
      case "sendMessage":
        return reply({ message_id: ++nextMessageId });
      default:
        return reply(true);
    }
  };

  /** Queues an update for the next `getUpdates`. */
  const push = (update: object) => {
    queue.push({ update_id: nextUpdateId++, ...update });
    wake?.();
  };
  const sent = () => calls.filter((c) => c.method === "sendMessage").map((c) => c.params);
  return { fetch, calls, push, sent };
}
