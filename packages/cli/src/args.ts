import { parseArgs } from "node:util";
import { LOCALES, type Locale } from "@denarii/core";
import type { D1Target } from "./import-command";

export const USAGE = `Usage: denarii import <file.json|file.csv> [options]

Imports already-categorized purchases (SPEC §10) into D1.

Options:
  --local            Local D1 used by wrangler dev (default)
  --remote           Deployed D1
  --dry-run          Validate and report, write nothing
  --chat-id=<id>     Telegram chat of the user (default: TELEGRAM_CHAT_ID)
  --timezone <tz>    Time zone of the dates (default: TIMEZONE, else America/Argentina/Cordoba)
  --locale <en|es>   Locale if the user is new (default: LOCALE, else en)

TELEGRAM_CHAT_ID, TIMEZONE and LOCALE are read from the environment, then from
apps/cloudflare/.dev.vars.`;

export interface ImportArgs {
  file: string;
  target: D1Target;
  dryRun: boolean;
  chatId: string;
  timezone: string;
  locale: Locale;
}

export type ArgsResult = { ok: true; args: ImportArgs } | { ok: false; error: string };

/** Parses `import <file> [options]`; `env` supplies defaults (process env, then .dev.vars). */
export function parseImportArgs(
  argv: string[],
  env: Record<string, string | undefined>,
): ArgsResult {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const { values, positionals } = parsed;
  const [command, file, ...rest] = positionals;
  if (command !== "import" || !file || rest.length > 0) return { ok: false, error: USAGE };
  if (values.local && values.remote)
    return { ok: false, error: "Use --local or --remote, not both" };

  const chatId = values["chat-id"] ?? env.TELEGRAM_CHAT_ID;
  if (!chatId || !/^-?\d+$/.test(chatId)) {
    return { ok: false, error: "Set --chat-id or TELEGRAM_CHAT_ID to the bot's Telegram chat id" };
  }
  const timezone = values.timezone ?? env.TIMEZONE ?? "America/Argentina/Cordoba";
  if (!isTimeZone(timezone)) return { ok: false, error: `Unknown time zone "${timezone}"` };
  const locale = values.locale ?? env.LOCALE ?? "en";
  if (!isLocale(locale)) return { ok: false, error: `Locale must be one of ${LOCALES.join(", ")}` };

  return {
    ok: true,
    args: {
      file,
      target: values.remote ? "remote" : "local",
      dryRun: values["dry-run"] ?? false,
      chatId,
      timezone,
      locale,
    },
  };
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      local: { type: "boolean" },
      remote: { type: "boolean" },
      "dry-run": { type: "boolean" },
      "chat-id": { type: "string" },
      timezone: { type: "string" },
      locale: { type: "string" },
    },
  });
}

/** `KEY=value` lines of a .dev.vars / .env file. Quotes around values are removed. */
export function parseDotenv(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match?.[1]) continue;
    const value = match[2] ?? "";
    vars[match[1]] = /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
  }
  return vars;
}

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
