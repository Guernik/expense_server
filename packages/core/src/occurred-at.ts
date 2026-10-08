/**
 * SPEC §5.4: the extracted "HH:MM" on the date of `receivedAt` in `timeZone`. If that is later
 * than `receivedAt` (notification just after midnight), the previous day. Without a valid time,
 * `receivedAt`.
 */
export function resolveOccurredAt(
  receivedAt: Date,
  time: string | undefined,
  timeZone: string,
): Date {
  const match = time ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time) : null;
  if (!match) return receivedAt;
  const hour = Number(match[1]);
  const minute = Number(match[2]);

  const { year, month, day } = wallClock(receivedAt, timeZone);
  const sameDay = zonedToUtc(year, month, day, hour, minute, timeZone);
  if (sameDay.getTime() <= receivedAt.getTime()) return sameDay;
  return zonedToUtc(year, month, day - 1, hour, minute, timeZone);
}

/** Local date and time in a time zone. */
export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function wallClock(date: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of `timeZone` from UTC at `date`, in ms (e.g. -3h for Argentina). */
function offsetAt(date: Date, timeZone: string): number {
  const w = wallClock(date, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Local wall-clock time in `timeZone` to a UTC instant. `day` may be out of range (Date.UTC rolls it). */
function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  // Second pass corrects for an offset change (DST) between the naive guess and the result.
  const first = naive - offsetAt(new Date(naive), timeZone);
  return new Date(naive - offsetAt(new Date(first), timeZone));
}
