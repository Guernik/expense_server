import { fileURLToPath } from "node:url";
import { handleTelegramUpdate, parseConfig, runScheduled } from "@denarii/api";
import { openSqliteDatabase } from "@denarii/db/sqlite";
import { serve } from "@hono/node-server";
import { pollTelegram } from "./polling";
import { createNodeRuntime } from "./runtime";
import { startMinuteTicker } from "./scheduler";
import { createNodeApp } from "./server";

export const DEFAULT_DATABASE_PATH = "/data/denarii.db";
export const DEFAULT_PORT = 3000;
const DEFAULT_WEB_ROOT = fileURLToPath(new URL("../../web/dist", import.meta.url));

export interface StartOptions {
  /** Telegram API calls (tests). */
  fetch?: typeof fetch;
  /** Poll timeout and retry delay (tests). */
  polling?: { timeoutSeconds?: number; retryMs?: number };
}

/**
 * Starts the Node runtime (ADR-0004): applies migrations to the SQLite file, serves the API and
 * SPA, runs the scheduler, and receives Telegram updates by polling (default) or webhook.
 * Environment as in SPEC §13.1, plus `PORT` and `WEB_ROOT` (the built SPA).
 */
export async function start(env: Record<string, string | undefined>, options: StartOptions = {}) {
  const config = parseConfig({ TELEGRAM_MODE: "polling", ...env });
  const db = openSqliteDatabase(env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH);
  const { runtime, idle } = createNodeRuntime(config, db, options.fetch);

  const app = createNodeApp(runtime, env.WEB_ROOT ?? DEFAULT_WEB_ROOT);
  const server = serve({ fetch: app.fetch, port: Number(env.PORT ?? DEFAULT_PORT) });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const stopTicker = startMinuteTicker((at) => runScheduled(runtime, at));

  const abort = new AbortController();
  const polling =
    config.TELEGRAM_MODE === "polling"
      ? pollTelegram({
          token: config.TELEGRAM_BOT_TOKEN,
          onUpdate: (update) => handleTelegramUpdate(runtime, update),
          signal: abort.signal,
          ...(options.fetch && { fetch: options.fetch }),
          ...options.polling,
        })
      : Promise.resolve();

  /** Stops taking work, waits for in-flight processing, then closes the database. */
  async function stop() {
    abort.abort();
    stopTicker();
    await new Promise((resolve) => server.close(resolve));
    await polling.catch(() => undefined);
    await idle();
    db.$client.close();
  }

  return { port, runtime, db, polling, idle, stop };
}
