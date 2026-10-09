import type { LlmProvider } from "@denarii/core";
import { z } from "zod";
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

/** SPEC §11: calls time out at 10 s. */
export const LLM_TIMEOUT_MS = 10_000;

export interface StructuredRequest<T extends z.ZodType> {
  operation: string;
  schema: T;
  system: string;
  prompt: string;
  maxTokens: number;
}

/** One structured-output call to a provider. Resolves to output that matches `schema`. */
export type StructuredCall = <T extends z.ZodType>(
  request: StructuredRequest<T>,
) => Promise<z.infer<T>>;

/**
 * The three operations of ADR-0010 on top of one provider's structured-output call, so every
 * provider sends the same prompts and maps the same output. Logs and rethrows any failure.
 */
export function createStructuredProvider(name: string, call: StructuredCall): LlmProvider {
  async function run<T extends z.ZodType>(request: StructuredRequest<T>): Promise<z.infer<T>> {
    try {
      return await call(request);
    } catch (error) {
      console.warn(`${name} ${request.operation} failed`, error);
      throw error;
    }
  }

  return {
    async suggestCategory(input) {
      const output = await run({
        operation: "suggestCategory",
        schema: suggestCategorySchema,
        system: SUGGEST_CATEGORY_SYSTEM,
        prompt: suggestCategoryPrompt(input),
        maxTokens: 256,
      });
      return {
        categoryId: output.category_id,
        newCategoryName: output.new_category_name,
        groupId: output.group_id,
        newGroupName: output.new_group_name,
      };
    },

    async extractPurchase(input) {
      const output = await run({
        operation: "extractPurchase",
        schema: extractPurchaseSchema,
        system: EXTRACT_PURCHASE_SYSTEM,
        prompt: notificationPrompt(input),
        maxTokens: 256,
      });
      return {
        amount: output.amount,
        currency: output.currency,
        merchant: output.merchant,
        paymentMethod: output.payment_method,
        time: output.time,
      };
    },

    async proposeRule(input) {
      const output = await run({
        operation: "proposeRule",
        schema: proposeRuleSchema,
        system: PROPOSE_RULE_SYSTEM,
        prompt: proposeRulePrompt(input),
        maxTokens: 1024,
      });
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

/** The schema as plain JSON Schema for providers that take one (all fields required, no extras). */
export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _, ...rest } = z.toJSONSchema(schema);
  return rest;
}

/** Validates a provider's output, given as a JSON string or an already parsed value. */
export function parseOutput<T extends z.ZodType>(schema: T, output: unknown): z.infer<T> {
  const value = typeof output === "string" ? JSON.parse(output) : output;
  return schema.parse(value);
}

/** Rejects with a timeout error when `promise` takes longer than `ms`. */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** POSTs JSON, aborting after `timeoutMs`. Rejects on a non-2xx status. */
export async function postJson(
  fetchFn: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const response = await fetchFn(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  return response.json();
}
