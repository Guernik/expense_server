import { type Clock, type Messenger, processEvent, type Store, t } from "@denarii/core";
import { type Context, type Env, Hono } from "hono";
import { z } from "zod";
import type { Config } from "./config";
import { loadRules } from "./rules";

/** What a runtime (Cloudflare, Node) provides per request. */
export interface Runtime {
  config: Config;
  store: Store;
  messenger: Messenger;
  clock: Clock;
  /** Runs work after the response is sent (waitUntil on Workers). */
  defer(task: Promise<unknown>): void;
}

const ingestBody = z.object({
  app: z.string().default(""),
  title: z.string(),
  text: z.string(),
  received_at: z.iso.datetime({ offset: true }).optional(),
});

const telegramUpdate = z.object({
  message: z.object({ chat: z.object({ id: z.number() }), text: z.string().optional() }).optional(),
});

export function createApp<E extends Env>(resolve: (c: Context<E>) => Runtime) {
  const app = new Hono<E>();

  app.post("/api/ingest", async (c) => {
    const runtime = resolve(c);
    const { config, store } = runtime;
    if (!safeEqual(c.req.header("x-webhook-secret") ?? "", config.WEBHOOK_SECRET)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const parsed = ingestBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400);

    const user = await store.ensureUser({
      telegramChatId: config.TELEGRAM_CHAT_ID,
      locale: config.LOCALE,
      timezone: config.TIMEZONE,
    });
    const body = parsed.data;
    const event = await store.insertEvent({
      userId: user.id,
      app: body.app,
      title: body.title,
      text: body.text,
      receivedAt: body.received_at ? new Date(body.received_at) : runtime.clock.now(),
    });

    const deps = { store, messenger: runtime.messenger, rules: loadRules(config.RULE_PACKS) };
    runtime.defer(
      processEvent(deps, user, event).catch((error: unknown) => {
        console.error(`Processing event ${event.id} failed`, error);
      }),
    );
    return c.json({ event_id: event.id }, 202);
  });

  app.post("/api/telegram", async (c) => {
    const { config, messenger } = resolve(c);
    const secret = c.req.header("x-telegram-bot-api-secret-token") ?? "";
    if (!safeEqual(secret, config.TELEGRAM_WEBHOOK_SECRET)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const update = telegramUpdate.safeParse(await c.req.json().catch(() => null));
    const message = update.success ? update.data.message : undefined;
    // The bot only talks to the configured chat; everything else is acknowledged and dropped.
    if (!message || String(message.chat.id) !== config.TELEGRAM_CHAT_ID) return c.body(null, 200);

    if (message.text?.startsWith("/start")) {
      await messenger.send(config.TELEGRAM_CHAT_ID, t(config.LOCALE, "start"));
    }
    return c.body(null, 200);
  });

  return app;
}

/** Constant-time comparison for equal-length secrets. */
function safeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
