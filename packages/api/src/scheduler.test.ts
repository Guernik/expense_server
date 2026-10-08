import { describe, expect, it, vi } from "vitest";
import { createTickScheduler } from "./scheduler";

describe("createTickScheduler", () => {
  it("runs only the jobs due at the tick, in their time zone", async () => {
    const { scheduler, run } = createTickScheduler();
    const ran: string[] = [];
    scheduler.schedule("0 21 * * *", "America/Argentina/Cordoba", async () => {
      ran.push("cordoba");
    });
    scheduler.schedule("0 21 * * *", "UTC", async () => {
      ran.push("utc");
    });
    await run(new Date("2026-10-08T00:00:00Z"));
    expect(ran).toEqual(["cordoba"]);
  });

  it("passes the tick time and keeps running other jobs when one fails", async () => {
    const { scheduler, run } = createTickScheduler();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: Date[] = [];
    scheduler.schedule("* * * * *", "UTC", async () => {
      throw new Error("boom");
    });
    scheduler.schedule("* * * * *", "UTC", async (now) => {
      seen.push(now);
    });
    const at = new Date("2026-10-08T00:00:00Z");
    await run(at);
    expect(seen).toEqual([at]);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it("rejects an invalid cron when a job is scheduled", () => {
    const { scheduler } = createTickScheduler();
    expect(() => scheduler.schedule("nope", "UTC", async () => {})).toThrow(/Invalid cron/);
  });
});
