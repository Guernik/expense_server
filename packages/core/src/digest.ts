import { t } from "./i18n";
import { normalizeBody, normalizeText } from "./normalize";
import type { Scheduler, StoredEvent, User } from "./ports";
import type { ProcessDeps } from "./process-event";
import { classify, compileRules } from "./rules/engine";

export const DEFAULT_DIGEST_CRON = "0 21 * * *";
export const DIGEST_WINDOW_MS = 24 * 60 * 60_000;
/** Events listed per digest section; the rest are counted. */
export const DIGEST_MAX_ITEMS = 5;
const MAX_ITEM_LENGTH = 80;

export type DigestDeps = ProcessDeps;

export interface Digest {
  pending: number;
  unmatched: StoredEvent[];
  /** Events the user said are not purchases with no ignore rule matching them now. */
  possibleMisses: StoredEvent[];
}

/** SPEC §7.6: what the daily digest reports at `now`. */
export async function buildDigest(deps: DigestDeps, user: User, now: Date): Promise<Digest> {
  const { store, packRules } = deps;
  const since = new Date(now.getTime() - DIGEST_WINDOW_MS);
  const [pending, unmatched, excluded, userRules] = await Promise.all([
    store.countPendingPurchases(user.id),
    store.listUnmatchedEvents(user.id),
    store.listExcludedEvents(user.id, since),
    store.listUserRules(user.id),
  ]);
  const rules = [...compileRules([], userRules), ...packRules];
  const possibleMisses = excluded.filter((event) => classify(rules, event).kind !== "ignore");
  return { pending, unmatched, possibleMisses };
}

/** The digest message, or null when there is nothing to report. */
export function digestText(user: User, digest: Digest): string | null {
  const { locale } = user;
  const sections: string[] = [];
  if (digest.pending > 0) {
    sections.push(t(locale, "digestPending", { count: String(digest.pending) }));
  }
  if (digest.unmatched.length > 0) {
    sections.push(eventSection(user, "digestUnmatched", digest.unmatched));
  }
  if (digest.possibleMisses.length > 0) {
    sections.push(eventSection(user, "digestMisses", digest.possibleMisses));
  }
  if (sections.length === 0) return null;
  return [t(locale, "digestTitle"), ...sections].join("\n\n");
}

function eventSection(
  user: User,
  heading: "digestUnmatched" | "digestMisses",
  events: StoredEvent[],
): string {
  const lines = [t(user.locale, heading, { count: String(events.length) })];
  lines.push(...events.slice(0, DIGEST_MAX_ITEMS).map(eventLine));
  if (events.length > DIGEST_MAX_ITEMS) {
    lines.push(t(user.locale, "digestMore", { count: String(events.length - DIGEST_MAX_ITEMS) }));
  }
  return lines.join("\n");
}

/** `• App: "title"`, falling back to the text when the title is empty. */
function eventLine(event: StoredEvent): string {
  const app = normalizeText(event.app);
  const chars = Array.from(normalizeText(event.title) || normalizeBody(event.text));
  const summary =
    chars.length > MAX_ITEM_LENGTH
      ? `${chars.slice(0, MAX_ITEM_LENGTH - 1).join("")}…`
      : chars.join("");
  return `• ${app ? `${app}: ` : ""}"${summary}"`;
}

/** Sends the digest to the user's chat unless it is empty. Returns whether it was sent. */
export async function sendDigest(deps: DigestDeps, user: User, now: Date): Promise<boolean> {
  const text = digestText(user, await buildDigest(deps, user, now));
  if (text === null) return false;
  await deps.messenger.send(user.telegramChatId, text);
  return true;
}

/** Registers the daily digest at `cron`, read in the user's time zone (SPEC §7.6). */
export function scheduleDigest(
  scheduler: Scheduler,
  cron: string,
  timeZone: string,
  deps: DigestDeps,
  user: () => Promise<User>,
): void {
  scheduler.schedule(cron, timeZone, async (now) => {
    await sendDigest(deps, await user(), now);
  });
}
