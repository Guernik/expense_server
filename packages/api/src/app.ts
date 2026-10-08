import { type Clock, type Messenger, processEvent, type Store, t } from "@denarii/core";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context, Env, MiddlewareHandler } from "hono";
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

export const OPENAPI_INFO = {
  openapi: "3.1.0",
  info: {
    title: "denarii API",
    version: "0.1.0",
    description:
      "Ingests payment notifications and receives Telegram bot updates. See SPEC.md §4 and §7.",
  },
} as const;

const ErrorBody = z.object({ error: z.string() }).openapi("Error");

const IngestBody = z
  .object({
    app: z.string().default("").openapi({
      description: "Originating app name (MacroDroid `[notification_app_name]`). Informational.",
      example: "Galicia",
    }),
    title: z
      .string()
      .openapi({ description: "Notification title.", example: "Pagaste $15.000,01" }),
    text: z.string().openapi({
      description: "Notification text.",
      example: "A AXION VILLA ALLENDE con tu Visa Crédito 3551 a las 22:32.",
    }),
    received_at: z.iso.datetime({ offset: true }).optional().openapi({
      description: "When the phone received the notification. Defaults to server receive time.",
      example: "2026-10-05T22:32:10-03:00",
    }),
  })
  .openapi("IngestRequest");

const IngestAccepted = z
  .object({ event_id: z.number().int().openapi({ example: 1 }) })
  .openapi("IngestAccepted");

const TelegramUpdate = z
  .looseObject({
    message: z
      .looseObject({
        chat: z.looseObject({ id: z.number().int() }),
        text: z.string().optional(),
      })
      .optional(),
  })
  .openapi("TelegramUpdate", {
    description:
      "Subset of a Telegram Bot API `Update` that denarii reads. Other fields are ignored.",
  });

const unauthorized = {
  description: "Missing or wrong secret header",
  content: { "application/json": { schema: ErrorBody } },
};

const ingestRoute = createRoute({
  method: "post",
  path: "/api/ingest",
  tags: ["Ingest"],
  summary: "Ingest a notification",
  description:
    "Stores the notification as an event and returns immediately. Classification, purchase " +
    "recording and the Telegram message happen asynchronously.",
  security: [{ webhookSecret: [] }],
  request: {
    body: { required: true, content: { "application/json": { schema: IngestBody } } },
  },
  responses: {
    202: {
      description: "Event stored; processing continues in the background",
      content: { "application/json": { schema: IngestAccepted } },
    },
    400: {
      description: "Body is not valid JSON or fails validation",
      content: { "application/json": { schema: ErrorBody } },
    },
    401: unauthorized,
  },
});

const telegramRoute = createRoute({
  method: "post",
  path: "/api/telegram",
  tags: ["Telegram"],
  summary: "Telegram webhook",
  description:
    "Receives bot updates (registered with `setWebhook`). Updates from chats other than " +
    "`TELEGRAM_CHAT_ID` are acknowledged and dropped.",
  security: [{ telegramSecret: [] }],
  request: {
    body: { required: true, content: { "application/json": { schema: TelegramUpdate } } },
  },
  responses: {
    200: { description: "Update handled or ignored" },
    400: {
      description: "Body is not valid JSON",
      content: { "application/json": { schema: ErrorBody } },
    },
    401: unauthorized,
  },
});

export function createApp<E extends Env>(resolve: (c: Context<E>) => Runtime) {
  const app = new OpenAPIHono<E>({
    defaultHook: (result, c) => {
      if (!result.success) return c.json({ error: z.prettifyError(result.error) }, 400);
    },
  });

  /** Checks a secret header before body validation, so unauthenticated callers learn nothing. */
  const requireSecret =
    (header: string, expected: (config: Config) => string): MiddlewareHandler<E> =>
    async (c, next) => {
      const { config } = resolve(c);
      if (!safeEqual(c.req.header(header) ?? "", expected(config))) {
        return c.json({ error: "unauthorized" }, 401);
      }
      await next();
    };

  app.openapi(
    { ...ingestRoute, middleware: [requireSecret("x-webhook-secret", (c) => c.WEBHOOK_SECRET)] },
    async (c) => {
      const runtime = resolve(c);
      const { config, store } = runtime;
      const body = c.req.valid("json");

      const user = await store.ensureUser({
        telegramChatId: config.TELEGRAM_CHAT_ID,
        locale: config.LOCALE,
        timezone: config.TIMEZONE,
      });
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
    },
  );

  app.openapi(
    {
      ...telegramRoute,
      middleware: [
        requireSecret("x-telegram-bot-api-secret-token", (c) => c.TELEGRAM_WEBHOOK_SECRET),
      ],
    },
    async (c) => {
      const { config, messenger } = resolve(c);
      const { message } = c.req.valid("json");
      // The bot only talks to the configured chat; everything else is acknowledged and dropped.
      if (!message || String(message.chat.id) !== config.TELEGRAM_CHAT_ID) {
        return c.body(null, 200);
      }
      if (message.text?.startsWith("/start")) {
        await messenger.send(config.TELEGRAM_CHAT_ID, t(config.LOCALE, "start"));
      }
      return c.body(null, 200);
    },
  );

  app.openAPIRegistry.registerComponent("securitySchemes", "webhookSecret", {
    type: "apiKey",
    in: "header",
    name: "X-Webhook-Secret",
    description: "`WEBHOOK_SECRET`, configured in the MacroDroid HTTP action.",
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "telegramSecret", {
    type: "apiKey",
    in: "header",
    name: "X-Telegram-Bot-Api-Secret-Token",
    description: "`TELEGRAM_WEBHOOK_SECRET`, sent by Telegram as set with `setWebhook`.",
  });
  app.doc31("/api/openapi.json", OPENAPI_INFO);

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
