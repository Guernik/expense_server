import { describe, expect, it } from "vitest";
import { cronMatches, parseCron } from "./cron";

const TZ = "America/Argentina/Cordoba";

describe("parseCron", () => {
  it("parses wildcards, ranges, steps and lists", () => {
    const s = parseCron("*/15 9-17 1,15 * 1-5");
    expect([...s.minute]).toEqual([0, 15, 30, 45]);
    expect([...s.hour]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect([...s.dayOfMonth]).toEqual([1, 15]);
    expect(s.month.size).toBe(12);
    expect([...s.dayOfWeek]).toEqual([1, 2, 3, 4, 5]);
  });

  it("folds day of week 7 into Sunday", () => {
    expect([...parseCron("0 0 * * 7").dayOfWeek]).toEqual([0]);
  });

  it.each([
    "",
    "0 21 * *",
    "60 * * * *",
    "* 24 * * *",
    "* * 0 * *",
    "5-1 * * * *",
    "*/0 * * * *",
    "a * * * *",
    "0 21 * * * *",
  ])("rejects %j", (expression) => {
    expect(() => parseCron(expression)).toThrow(/Invalid cron/);
  });
});

describe("cronMatches", () => {
  const daily = parseCron("0 21 * * *");

  it("reads the schedule in the given time zone", () => {
    // 21:00 in Córdoba (UTC-3) is 00:00 UTC the next day.
    expect(cronMatches(daily, new Date("2026-10-08T00:00:00Z"), TZ)).toBe(true);
    expect(cronMatches(daily, new Date("2026-10-08T00:00:59Z"), TZ)).toBe(true);
    expect(cronMatches(daily, new Date("2026-10-07T21:00:00Z"), TZ)).toBe(false);
    expect(cronMatches(daily, new Date("2026-10-07T21:00:00Z"), "UTC")).toBe(true);
    expect(cronMatches(daily, new Date("2026-10-08T00:01:00Z"), TZ)).toBe(false);
  });

  it("uses the local weekday and ORs restricted day fields", () => {
    // 2026-10-09 is a Friday in Córdoba; 00:30 UTC on the 10th is still Friday 21:30 there.
    const fridays = parseCron("30 21 * * 5");
    expect(cronMatches(fridays, new Date("2026-10-10T00:30:00Z"), TZ)).toBe(true);
    expect(cronMatches(fridays, new Date("2026-10-10T00:30:00Z"), "UTC")).toBe(false);

    const firstOrMonday = parseCron("0 9 1 * 1");
    expect(cronMatches(firstOrMonday, new Date("2026-10-01T12:00:00Z"), TZ)).toBe(true); // Thu 1st
    expect(cronMatches(firstOrMonday, new Date("2026-10-05T12:00:00Z"), TZ)).toBe(true); // Mon 5th
    expect(cronMatches(firstOrMonday, new Date("2026-10-06T12:00:00Z"), TZ)).toBe(false);
  });
});
