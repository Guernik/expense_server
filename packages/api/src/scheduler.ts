import { cronMatches, parseCron, type Scheduler } from "@denarii/core";

/**
 * A `Scheduler` for runtimes that wake on a fixed timer and ask what is due, like Cloudflare Cron
 * Triggers, which only run in UTC. The runtime calls `run` every minute; jobs whose cron matches
 * that minute in their time zone run.
 */
export function createTickScheduler() {
  const jobs: {
    cron: ReturnType<typeof parseCron>;
    timeZone: string;
    job: (now: Date) => Promise<void>;
  }[] = [];
  const scheduler: Scheduler = {
    schedule(cron, timeZone, job) {
      jobs.push({ cron: parseCron(cron), timeZone, job });
    },
  };
  /** Runs every job due at `at`. One failing job does not stop the others. */
  const run = async (at: Date) => {
    const due = jobs.filter((j) => cronMatches(j.cron, at, j.timeZone));
    const results = await Promise.allSettled(due.map((j) => j.job(at)));
    for (const result of results) {
      if (result.status === "rejected") console.error("Scheduled job failed", result.reason);
    }
  };
  return { scheduler, run };
}
