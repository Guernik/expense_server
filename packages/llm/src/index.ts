import type { LlmProvider } from "@denarii/core";
import { createAnthropicProvider } from "./anthropic";

export { ANTHROPIC_DEFAULT_MODEL, createAnthropicProvider, LLM_TIMEOUT_MS } from "./anthropic";

export const LLM_PROVIDERS = ["none", "anthropic"] as const;

export interface LlmConfig {
  LLM_PROVIDER: (typeof LLM_PROVIDERS)[number];
  LLM_MODEL?: string | undefined;
  ANTHROPIC_API_KEY?: string | undefined;
}

/** The configured provider, or undefined for `LLM_PROVIDER=none` (SPEC §11). */
export function createLlmProvider(config: LlmConfig): LlmProvider | undefined {
  switch (config.LLM_PROVIDER) {
    case "none":
      return undefined;
    case "anthropic":
      if (!config.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required");
      return createAnthropicProvider({ apiKey: config.ANTHROPIC_API_KEY, model: config.LLM_MODEL });
  }
}
