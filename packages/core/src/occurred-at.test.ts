import { describe, expect, it } from "vitest";
import { resolveOccurredAt } from "./occurred-at";

const TZ = "America/Argentina/Cordoba";

describe("resolveOccurredAt", () => {
  it("uses the extracted time on the local date of received_at", () => {
    const received = new Date("2026-10-05T22:32:10-03:00");
    expect(resolveOccurredAt(received, "22:32", TZ).toISOString()).toBe("2026-10-06T01:32:00.000Z");
  });

  it("uses the local date, not the UTC one", () => {
    // 01:32Z on the 7th is still the 6th in Argentina.
    const received = new Date("2026-10-07T01:32:10Z");
    expect(resolveOccurredAt(received, "22:30", TZ).toISOString()).toBe("2026-10-07T01:30:00.000Z");
  });

  it("rolls back a day when the time is after received_at", () => {
    const received = new Date("2026-10-06T00:01:05-03:00");
    expect(resolveOccurredAt(received, "23:59", TZ).toISOString()).toBe("2026-10-06T02:59:00.000Z");
  });

  it("rolls back across a month boundary", () => {
    const received = new Date("2026-11-01T00:00:30-03:00");
    expect(resolveOccurredAt(received, "23:58", TZ).toISOString()).toBe("2026-11-01T02:58:00.000Z");
  });

  it("handles DST time zones", () => {
    // New York switches to EST on 2026-11-01 at 02:00 local.
    const received = new Date("2026-11-01T12:00:00-05:00");
    expect(resolveOccurredAt(received, "01:30", "America/New_York").toISOString()).toBe(
      "2026-11-01T05:30:00.000Z",
    );
    expect(resolveOccurredAt(received, "11:15", "America/New_York").toISOString()).toBe(
      "2026-11-01T16:15:00.000Z",
    );
  });

  it("falls back to received_at without a valid time", () => {
    const received = new Date("2026-10-05T22:32:10-03:00");
    expect(resolveOccurredAt(received, undefined, TZ)).toBe(received);
    expect(resolveOccurredAt(received, "25:00", TZ)).toBe(received);
  });
});
