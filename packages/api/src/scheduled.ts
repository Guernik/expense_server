import { scheduleDigest } from "@denarii/core";
import { ensureUser, type Runtime } from "./app";
import { loadRules } from "./rules";
import { createTickScheduler } from "./scheduler";

/** Runs the scheduled jobs due at `at` (one Cron Trigger tick on Cloudflare). */
export async function runScheduled(runtime: Runtime, at: Date): Promise<void> {
  const { config } = runtime;
  const { scheduler, run } = createTickScheduler();
  const deps = { ...runtime, packRules: loadRules(config.RULE_PACKS) };
  scheduleDigest(scheduler, config.DIGEST_CRON, config.TIMEZONE, deps, () => ensureUser(runtime));
  await run(at);
}
