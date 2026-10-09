import type { LlmProvider } from "@denarii/core";
import { createAnthropicProvider } from "./anthropic";
import { createOpenAiProvider } from "./openai";
import { createWorkersAiProvider, type WorkersAiBinding } from "./workers-ai";

export { ANTHROPIC_DEFAULT_MODEL, createAnthropicProvider } from "./anthropic";
export { createOpenAiProvider, OPENAI_DEFAULT_BASE_URL } from "./openai";
export { LLM_TIMEOUT_MS } from "./structured";
export { createWorkersAiProvider, type WorkersAiBinding } from "./workers-ai";

export const LLM_PROVIDERS = ["none", "anthropic", "openai", "workers-ai"] as const;

export interface LlmConfig {
  LLM_PROVIDER: (typeof LLM_PROVIDERS)[number];
  LLM_MODEL?: string | undefined;
  ANTHROPIC_API_KEY?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
  OPENAI_BASE_URL?: string | undefined;
  CF_ACCOUNT_ID?: string | undefined;
  CF_API_TOKEN?: string | undefined;
}

/** Runtime bindings that aren't environment strings. */
export interface LlmBindings {
  /** The Cloudflare `AI` binding, when the Worker has one. */
  ai?: WorkersAiBinding | undefined;
}

/** The configured provider, or undefined for `LLM_PROVIDER=none` (SPEC §11). */
export function createLlmProvider(
  config: LlmConfig,
  bindings: LlmBindings = {},
): LlmProvider | undefined {
  switch (config.LLM_PROVIDER) {
    case "none":
      return undefined;
    case "anthropic":
      if (!config.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required");
      return createAnthropicProvider({ apiKey: config.ANTHROPIC_API_KEY, model: config.LLM_MODEL });
    case "openai":
      if (!config.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");
      if (!config.LLM_MODEL) throw new Error("LLM_MODEL is required");
      return createOpenAiProvider({
        apiKey: config.OPENAI_API_KEY,
        model: config.LLM_MODEL,
        baseUrl: config.OPENAI_BASE_URL,
      });
    case "workers-ai": {
      if (!config.LLM_MODEL) throw new Error("LLM_MODEL is required");
      if (bindings.ai)
        return createWorkersAiProvider({ model: config.LLM_MODEL, backend: bindings.ai });
      if (!config.CF_ACCOUNT_ID || !config.CF_API_TOKEN) {
        throw new Error("The AI binding, or CF_ACCOUNT_ID and CF_API_TOKEN, are required");
      }
      return createWorkersAiProvider({
        model: config.LLM_MODEL,
        backend: { accountId: config.CF_ACCOUNT_ID, apiToken: config.CF_API_TOKEN },
      });
    }
  }
}
