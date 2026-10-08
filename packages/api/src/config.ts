import { LOCALES } from "@denarii/core";
import { LLM_PROVIDERS } from "@denarii/llm";
import { z } from "zod";

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Runtime configuration from environment variables (SPEC §13.1). */
export const configSchema = z
  .object({
    WEBHOOK_SECRET: z.string().min(16, "use at least 16 characters"),
    TELEGRAM_BOT_TOKEN: z.string().min(1),
    TELEGRAM_CHAT_ID: z.string().regex(/^-?\d+$/),
    TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{16,256}$/),
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
    LLM_PROVIDER: z.enum(LLM_PROVIDERS).default("none"),
    LLM_MODEL: z.string().min(1).optional(),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
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
