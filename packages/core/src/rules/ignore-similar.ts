import { normalizeBody, normalizeText } from "../normalize";
import type { StoredEvent } from "../ports";
import type { Rule } from "./schema";

/** Web Crypto, on Workers and Node. Declared here because core compiles without platform types. */
declare const crypto: { randomUUID(): string };

const NUMBER_RUN = /\d(?:[\d.,]*\d)?/g;
const NUMBER_PATTERN = "[\\d.,]+";

/** Escapes regex syntax characters. Only these may be escaped under the `u` flag. */
function escapeRegex(literal: string): string {
  return literal.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
}

/** SPEC §7.3: the escaped value anchored `^…$`, with every number run generalized to `[\d.,]+`. */
export function similarPattern(value: string): string {
  const literals = value.split(NUMBER_RUN).map(escapeRegex);
  return `^${literals.join(NUMBER_PATTERN)}$`;
}

/**
 * What "Ignore similar" matches: the title, or the text when the title is empty, so it can never
 * be an empty pattern that ignores everything.
 */
export function similarMatch(event: StoredEvent): { title: string } | { text: string } {
  const title = normalizeText(event.title);
  return title
    ? { title: similarPattern(title) }
    : { text: similarPattern(normalizeBody(event.text)) };
}

/** The `ignore` user rule saved by "Ignore similar" (ADR-0003). */
export function ignoreSimilarRule(event: StoredEvent): Rule {
  return {
    id: `user.${crypto.randomUUID()}`,
    kind: "ignore",
    priority: 0,
    match: similarMatch(event),
    transform: {},
    tests: [{ title: event.title, text: event.text, app: event.app, expect_kind: "ignore" }],
  };
}
