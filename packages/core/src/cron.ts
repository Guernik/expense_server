import { wallClock } from "./occurred-at";

/** A parsed five-field cron expression: minute, hour, day of month, month, day of week. */
export interface CronSchedule {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  /** 0 = Sunday. `7` in the expression is folded into 0. */
  dayOfWeek: Set<number>;
  /** Whether the day fields were restricted (not `*`). Cron ORs them when both are. */
  dayOfMonthAny: boolean;
  dayOfWeekAny: boolean;
}

const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day of week", min: 0, max: 7 },
] as const;

/**
 * Parses a standard five-field cron expression (`*`, numbers, `a-b`, `/step` and `,` lists).
 * Throws on anything else, so configuration errors surface at startup.
 */
export function parseCron(expression: string): CronSchedule {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== FIELDS.length) {
    throw new Error(`Invalid cron "${expression}": expected 5 fields, got ${parts.length}`);
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = FIELDS.map((field, i) =>
    parseField(parts[i] ?? "", field.min, field.max, () => {
      throw new Error(`Invalid cron "${expression}": bad ${field.name} "${parts[i]}"`);
    }),
  ) as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
  if (dayOfWeek.delete(7)) dayOfWeek.add(0);
  return {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
    dayOfMonthAny: parts[2] === "*",
    dayOfWeekAny: parts[4] === "*",
  };
}

function parseField(field: string, min: number, max: number, fail: () => never): Set<number> {
  const values = new Set<number>();
  for (const item of field.split(",")) {
    const match = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(item);
    if (!match) fail();
    const [, range, from, to, step] = match;
    const start = range === "*" ? min : Number(from);
    const end = range === "*" ? max : to !== undefined ? Number(to) : step ? max : start;
    const increment = step === undefined ? 1 : Number(step);
    if (start < min || end > max || start > end || increment < 1) fail();
    for (let v = start; v <= end; v += increment) values.add(v);
  }
  return values;
}

/** Whether the schedule fires in the minute containing `date`, read as local time in `timeZone`. */
export function cronMatches(schedule: CronSchedule, date: Date, timeZone: string): boolean {
  const local = wallClock(date, timeZone);
  const weekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
  const domMatch = schedule.dayOfMonth.has(local.day);
  const dowMatch = schedule.dayOfWeek.has(weekday);
  const dayMatch =
    schedule.dayOfMonthAny || schedule.dayOfWeekAny ? domMatch && dowMatch : domMatch || dowMatch;
  return (
    schedule.minute.has(local.minute) &&
    schedule.hour.has(local.hour) &&
    schedule.month.has(local.month) &&
    dayMatch
  );
}
