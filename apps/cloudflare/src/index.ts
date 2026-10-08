import { createApp, createTelegramMessenger, parseConfig } from "@denarii/api";
import { createStore, schema } from "@denarii/db";
import { drizzle } from "drizzle-orm/d1";

const app = createApp<{ Bindings: Env }>((c) => {
  const config = parseConfig(c.env);
  return {
    config,
    store: createStore(drizzle(c.env.DB, { schema })),
    messenger: createTelegramMessenger(config.TELEGRAM_BOT_TOKEN),
    clock: { now: () => new Date() },
    defer: (task) => c.executionCtx.waitUntil(task),
  };
});

export default { fetch: app.fetch } satisfies ExportedHandler<Env>;
