import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { LlmProvider } from "@denarii/core";
import { createStructuredProvider, LLM_TIMEOUT_MS } from "./structured";

export const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-4-5";

export interface AnthropicOptions {
  apiKey: string;
  model?: string | undefined;
  timeoutMs?: number;
  /** For tests: a fake `fetch`, so unit tests never reach the network. */
  fetch?: typeof fetch;
}

export function createAnthropicProvider(options: AnthropicOptions): LlmProvider {
  const client = new Anthropic({
    apiKey: options.apiKey,
    timeout: options.timeoutMs ?? LLM_TIMEOUT_MS,
    // Retries would stretch the 10 s budget; a failure falls back to the manual path instead.
    maxRetries: 0,
    ...(options.fetch && { fetch: options.fetch }),
  });
  const model = options.model ?? ANTHROPIC_DEFAULT_MODEL;

  return createStructuredProvider("Anthropic", async ({ schema, system, prompt, maxTokens }) => {
    const response = await client.messages.parse({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: prompt }],
      output_config: { format: zodOutputFormat(schema) },
    });
    const output = response.parsed_output;
    if (!output) throw new Error(`No structured output (stop_reason ${response.stop_reason})`);
    return output;
  });
}
