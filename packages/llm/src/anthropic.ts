import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { LlmProvider } from "@denarii/core";
import { SUGGEST_CATEGORY_SYSTEM, suggestCategoryPrompt, suggestCategorySchema } from "./prompt";

export const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-4-5";
/** SPEC §11: calls time out at 10 s. */
export const LLM_TIMEOUT_MS = 10_000;

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
    // Retries would stretch the 10 s budget; a failure falls back to the picker instead.
    maxRetries: 0,
    ...(options.fetch && { fetch: options.fetch }),
  });
  const model = options.model ?? ANTHROPIC_DEFAULT_MODEL;

  return {
    async suggestCategory(input) {
      try {
        const response = await client.messages.parse({
          model,
          max_tokens: 256,
          system: SUGGEST_CATEGORY_SYSTEM,
          messages: [{ role: "user", content: suggestCategoryPrompt(input) }],
          output_config: { format: zodOutputFormat(suggestCategorySchema) },
        });
        const output = response.parsed_output;
        if (!output) throw new Error(`No structured output (stop_reason ${response.stop_reason})`);
        return {
          categoryId: output.category_id,
          newCategoryName: output.new_category_name,
          groupId: output.group_id,
          newGroupName: output.new_group_name,
        };
      } catch (error) {
        console.warn("Anthropic suggestCategory failed", error);
        throw error;
      }
    },
  };
}
