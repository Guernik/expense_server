/** A bot command typed in the chat (SPEC §7.5). */
export interface Command {
  /** Lowercase name without the slash or a `@botname` suffix. */
  name: string;
  /** Text after the command, trimmed. */
  args: string;
}

/** Returns null unless `text` starts with `/<name>`. */
export function parseCommand(text: string): Command | null {
  const match = /^\/([a-zA-Z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;
  return { name: (match[1] ?? "").toLowerCase(), args: (match[2] ?? "").trim() };
}

/**
 * Splits `/setgroup` arguments into a category and a group. Names may contain spaces, so the
 * longest leading words that name a known category win, e.g. `Fast food Food` with a `Fast food`
 * category. Null when no leading words name a category or no group name is left.
 */
export function splitSetGroupArgs<C>(
  args: string,
  findCategory: (name: string) => C | undefined,
): { category: C; group: string } | null {
  const words = args.split(/\s+/).filter(Boolean);
  for (let i = words.length - 1; i >= 1; i--) {
    const category = findCategory(words.slice(0, i).join(" "));
    if (category !== undefined) return { category, group: words.slice(i).join(" ") };
  }
  return null;
}
