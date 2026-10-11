import { DEFAULT_DIGEST_CRON, LOCALES, parseCron } from "@denarii/core";
import { LLM_PROVIDERS } from "@denarii/llm";
import { z } from "zod";

function isCron(expression: string): boolean {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const TELEGRAM_MODES = ["webhook", "polling"] as const;

/** Runtime configuration from environment variables (SPEC §13.1). */
export const configSchema = z
  .object({
    WEBHOOK_SECRET: z.string().min(16, "use at least 16 characters"),
    TELEGRAM_BOT_TOKEN: z.string().min(1),
    TELEGRAM_CHAT_ID: z.string().regex(/^-?\d+$/),
    /** `webhook` on Cloudflare (only option); the Node runtime defaults to `polling`. */
    TELEGRAM_MODE: z.enum(TELEGRAM_MODES).default("webhook"),
    TELEGRAM_WEBHOOK_SECRET: z
      .string()
      .regex(/^[A-Za-z0-9_-]{16,256}$/)
      .optional(),
    RULE_PACKS: z
      .string()
      .transform((s) =>
        s
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.string()).min(1)),
    TIMEZONE: z
      .string()
      .default("America/Argentina/Cordoba")
      .refine(isTimeZone, "unknown time zone"),
    LOCALE: z.enum(LOCALES).default("en"),
    /** Daily digest schedule, local time in `TIMEZONE` (SPEC §7.6). */
    DIGEST_CRON: z.string().default(DEFAULT_DIGEST_CRON).refine(isCron, "invalid cron expression"),
    LLM_PROVIDER: z.enum(LLM_PROVIDERS).default("none"),
    LLM_MODEL: z.string().min(1).optional(),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
  })
  .refine((c) => c.TELEGRAM_MODE !== "webhook" || c.TELEGRAM_WEBHOOK_SECRET, {
    message: "required when TELEGRAM_MODE=webhook",
    path: ["TELEGRAM_WEBHOOK_SECRET"],
  })
  .refine((c) => c.LLM_PROVIDER !== "anthropic" || c.ANTHROPIC_API_KEY, {
    message: "required when LLM_PROVIDER=anthropic",
    path: ["ANTHROPIC_API_KEY"],
  });

export type Config = z.output<typeof configSchema>;

export function parseConfig(env: object): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) throw new Error(`Invalid configuration: ${z.prettifyError(result.error)}`);
  return result.data;
}
