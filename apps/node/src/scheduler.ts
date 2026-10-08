import cron from "node-cron";

/**
 * Wakes every minute with node-cron and runs the jobs due then, the same tick model as Cloudflare
 * Cron Triggers, so `DIGEST_CRON` is matched in `TIMEZONE` by the same code on both runtimes.
 * Returns a function that stops the timer.
 */
export function startMinuteTicker(tick: (at: Date) => Promise<void>): () => void {
  const task = cron.schedule(
    "* * * * *",
    async ({ date }) => {
      try {
        await tick(date);
      } catch (error) {
        console.error("Scheduled tick failed", error);
      }
    },
    { name: "denarii-tick", noOverlap: true },
  );
  return () => void task.destroy();
}
