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
    /** Daily digest schedule, local time in `TIMEZONE` (SPEC §7.6). */
    DIGEST_CRON: z.string().default(DEFAULT_DIGEST_CRON).refine(isCron, "invalid cron expression"),
    LLM_PROVIDER: z.enum(LLM_PROVIDERS).default("none"),
    LLM_MODEL: z.string().min(1).optional(),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    /** Any OpenAI-compatible endpoint (SPEC §11). */
    OPENAI_BASE_URL: z.url().optional(),
    /** Workers AI over REST, when the Worker has no `AI` binding (Node). */
    CF_ACCOUNT_ID: z.string().min(1).optional(),
    CF_API_TOKEN: z.string().min(1).optional(),
  })
  .superRefine((c, ctx) => {
    const require = (key: keyof typeof c) => {
      if (!c[key]) {
        ctx.addIssue({
          code: "custom",
          message: `required when LLM_PROVIDER=${c.LLM_PROVIDER}`,
          path: [key],
        });
      }
    };
    if (c.LLM_PROVIDER === "anthropic") require("ANTHROPIC_API_KEY");
    if (c.LLM_PROVIDER === "openai") {
      require("OPENAI_API_KEY");
      require("LLM_MODEL");
    }
    // The `AI` binding isn't an environment string, so CF_ACCOUNT_ID and CF_API_TOKEN are checked
    // when the provider is created.
    if (c.LLM_PROVIDER === "workers-ai") require("LLM_MODEL");
  });

export type Config = z.output<typeof configSchema>;

export function parseConfig(env: object): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) throw new Error(`Invalid configuration: ${z.prettifyError(result.error)}`);
  return result.data;
}
