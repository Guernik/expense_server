import type { LlmProvider } from "@denarii/core";
import {
  createStructuredProvider,
  jsonSchema,
  LLM_TIMEOUT_MS,
  parseOutput,
  postJson,
  withTimeout,
} from "./structured";

/** The part of the Cloudflare `AI` binding this provider uses, so the package needs no Workers types. */
export interface WorkersAiBinding {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

/** On Node (or a Worker without the binding): the Workers AI REST API. */
export interface WorkersAiRestCredentials {
  accountId: string;
  apiToken: string;
  /** For tests: a fake `fetch`, so unit tests never reach the network. */
  fetch?: typeof fetch;
}

export interface WorkersAiOptions {
  /** Required: Workers AI has no single default model for JSON mode (SPEC §11). */
  model: string;
  /** The `AI` binding, or REST credentials when there is none. */
  backend: WorkersAiBinding | WorkersAiRestCredentials;
  timeoutMs?: number;
}

export const WORKERS_AI_API_URL = "https://api.cloudflare.com/client/v4/accounts";

/** The REST API as a binding: same inputs, unwraps `{ result }`. */
function restBinding(credentials: WorkersAiRestCredentials, timeoutMs: number): WorkersAiBinding {
  const fetchFn = credentials.fetch ?? fetch;
  return {
    async run(model, inputs) {
      const body = (await postJson(
        fetchFn,
        `${WORKERS_AI_API_URL}/${encodeURIComponent(credentials.accountId)}/ai/run/${model}`,
        { authorization: `Bearer ${credentials.apiToken}` },
        inputs,
        timeoutMs,
      )) as { success?: boolean; result?: unknown; errors?: unknown };
      if (body.success === false)
        throw new Error(`Workers AI error: ${JSON.stringify(body.errors)}`);
      return body.result;
    },
  };
}

/** Workers AI text generation in JSON mode (`response_format: json_schema`). */
export function createWorkersAiProvider(options: WorkersAiOptions): LlmProvider {
  const timeoutMs = options.timeoutMs ?? LLM_TIMEOUT_MS;
  const ai = "run" in options.backend ? options.backend : restBinding(options.backend, timeoutMs);

  return createStructuredProvider("Workers AI", async ({ schema, system, prompt, maxTokens }) => {
    const result = (await withTimeout(
      ai.run(options.model, {
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_schema", json_schema: jsonSchema(schema) },
      }),
      timeoutMs,
    )) as { response?: unknown } | null;
    // JSON mode returns `response` as an object; some models return it as a JSON string.
    if (result?.response === undefined || result.response === null || result.response === "") {
      throw new Error("No structured output");
    }
    return parseOutput(schema, result.response);
  });
}
