import { type Config, createTelegramMessenger, type Runtime } from "@denarii/api";
import { createStore, type Database } from "@denarii/db";
import { createLlmProvider } from "@denarii/llm";

/**
 * The long-lived Node `Runtime`. Deferred work runs in-process after the response is sent;
 * `idle` resolves once everything deferred so far has finished (graceful shutdown, tests).
 */
export function createNodeRuntime(config: Config, db: Database, fetchFn: typeof fetch = fetch) {
  const pending = new Set<Promise<void>>();
  const runtime: Runtime = {
    config,
    store: createStore(db),
    messenger: createTelegramMessenger(config.TELEGRAM_BOT_TOKEN, fetchFn),
    clock: { now: () => new Date() },
    llm: createLlmProvider(config),
    defer(task) {
      const tracked = task.then(
        () => undefined,
        (error: unknown) => console.error("Background task failed", error),
      );
      pending.add(tracked);
      void tracked.finally(() => pending.delete(tracked));
    },
  };
  const idle = async () => {
    while (pending.size > 0) await Promise.all(pending);
  };
  return { runtime, idle };
}
