import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { LlmProvider } from "@denarii/core";
import type { z } from "zod";
import {
  EXTRACT_PURCHASE_SYSTEM,
  extractPurchaseSchema,
  notificationPrompt,
  PROPOSE_RULE_SYSTEM,
  proposeRulePrompt,
  proposeRuleSchema,
  SUGGEST_CATEGORY_SYSTEM,
  suggestCategoryPrompt,
  suggestCategorySchema,
} from "./prompt";

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
    // Retries would stretch the 10 s budget; a failure falls back to the manual path instead.
    maxRetries: 0,
    ...(options.fetch && { fetch: options.fetch }),
  });
  const model = options.model ?? ANTHROPIC_DEFAULT_MODEL;

  /** One structured-output call. Logs and rethrows any failure. */
  async function call<T extends z.ZodType>(
    operation: string,
    schema: T,
    system: string,
    prompt: string,
    maxTokens: number,
  ): Promise<z.infer<T>> {
    try {
      const response = await client.messages.parse({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: prompt }],
        output_config: { format: zodOutputFormat(schema) },
      });
      const output = response.parsed_output;
      if (!output) throw new Error(`No structured output (stop_reason ${response.stop_reason})`);
      return output as z.infer<T>;
    } catch (error) {
      console.warn(`Anthropic ${operation} failed`, error);
      throw error;
    }
  }

  return {
    async suggestCategory(input) {
      const output = await call(
        "suggestCategory",
        suggestCategorySchema,
        SUGGEST_CATEGORY_SYSTEM,
        suggestCategoryPrompt(input),
        256,
      );
      return {
        categoryId: output.category_id,
        newCategoryName: output.new_category_name,
        groupId: output.group_id,
        newGroupName: output.new_group_name,
      };
    },

    async extractPurchase(input) {
      const output = await call(
        "extractPurchase",
        extractPurchaseSchema,
        EXTRACT_PURCHASE_SYSTEM,
        notificationPrompt(input),
        256,
      );
      return {
        amount: output.amount,
        currency: output.currency,
        merchant: output.merchant,
        paymentMethod: output.payment_method,
        time: output.time,
      };
    },

    async proposeRule(input) {
      const output = await call(
        "proposeRule",
        proposeRuleSchema,
        PROPOSE_RULE_SYSTEM,
        proposeRulePrompt(input),
        1024,
      );
      return {
        title: output.title,
        text: output.text,
        numberFormat: output.number_format,
        currencyMap: Object.fromEntries(output.currency_map.map((m) => [m.token, m.currency])),
        defaultCurrency: output.default_currency,
        paymentMethod: output.payment_method,
        merchant: output.merchant,
      };
    },
  };
}
