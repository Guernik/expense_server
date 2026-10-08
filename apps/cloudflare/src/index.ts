import {
  createApp,
  createTelegramMessenger,
  parseConfig,
  type Runtime,
  runScheduled,
} from "@denarii/api";
import { createStore, schema } from "@denarii/db";
import { drizzle } from "drizzle-orm/d1";

function runtime(env: Env, ctx: Pick<ExecutionContext, "waitUntil">): Runtime {
  const config = parseConfig(env);
  return {
    config,
    store: createStore(drizzle(env.DB, { schema })),
    messenger: createTelegramMessenger(config.TELEGRAM_BOT_TOKEN),
    clock: { now: () => new Date() },
    defer: (task) => ctx.waitUntil(task),
  };
}

const app = createApp<{ Bindings: Env }>((c) => runtime(c.env, c.executionCtx));

export default {
  fetch: app.fetch,
  /** Cron Triggers run in UTC every minute; `DIGEST_CRON` is matched in `TIMEZONE` (SPEC §7.6). */
  scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(runtime(env, ctx), new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
