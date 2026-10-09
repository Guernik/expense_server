import type { LlmProvider } from "@denarii/core";
import {
  createStructuredProvider,
  jsonSchema,
  LLM_TIMEOUT_MS,
  parseOutput,
  postJson,
} from "./structured";

export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

export interface OpenAiOptions {
  apiKey: string;
  /** Required: compatible endpoints serve different models (SPEC §11). */
  model: string;
  /** Any OpenAI-compatible Chat Completions endpoint. Default {@link OPENAI_DEFAULT_BASE_URL}. */
  baseUrl?: string | undefined;
  timeoutMs?: number;
  /** For tests: a fake `fetch`, so unit tests never reach the network. */
  fetch?: typeof fetch;
}

interface ChatCompletion {
  choices?: {
    finish_reason?: string;
    message?: { content?: string | null; refusal?: string | null };
  }[];
}

/** OpenAI Chat Completions with a strict JSON Schema `response_format`. No retries (10 s budget). */
export function createOpenAiProvider(options: OpenAiOptions): LlmProvider {
  const url = `${(options.baseUrl ?? OPENAI_DEFAULT_BASE_URL).replace(/\/+$/, "")}/chat/completions`;
  const fetchFn = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? LLM_TIMEOUT_MS;

  return createStructuredProvider(
    "OpenAI",
    async ({ operation, schema, system, prompt, maxTokens }) => {
      const completion = (await postJson(
        fetchFn,
        url,
        { authorization: `Bearer ${options.apiKey}` },
        {
          model: options.model,
          max_tokens: maxTokens,
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: operation, strict: true, schema: jsonSchema(schema) },
          },
        },
        timeoutMs,
      )) as ChatCompletion;
      const choice = completion.choices?.[0];
      const content = choice?.message?.content;
      if (!content) {
        throw new Error(
          `No structured output (finish_reason ${choice?.finish_reason}, refusal ${choice?.message?.refusal})`,
        );
      }
      return parseOutput(schema, content);
    },
  );
}
