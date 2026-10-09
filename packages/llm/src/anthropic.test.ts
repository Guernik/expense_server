import { describe, expect, it } from "vitest";
import { ANTHROPIC_DEFAULT_MODEL, createAnthropicProvider } from "./anthropic";
import { fakeFetch, SUGGEST_INPUT } from "./testing";

/** Anthropic wire details. Behavior shared by every provider is in contract.test.ts. */
function messageResponse(output: unknown) {
  return Response.json({
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: ANTHROPIC_DEFAULT_MODEL,
    content: [{ type: "text", text: JSON.stringify(output) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  });
}

const SUGGESTION = {
  category_id: 10,
  new_category_name: null,
  group_id: null,
  new_group_name: null,
};

describe("Anthropic provider", () => {
  it("asks claude-haiku-4-5 for structured output", async () => {
    const { fetch, requests } = fakeFetch(() => messageResponse(SUGGESTION));
    await createAnthropicProvider({ apiKey: "test-key", fetch }).suggestCategory(SUGGEST_INPUT);

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request?.headers.get("x-api-key")).toBe("test-key");
    expect(request?.body).toMatchObject({
      model: "claude-haiku-4-5",
      output_config: { format: { type: "json_schema" } },
    });
  });

  it("uses LLM_MODEL when set", async () => {
    const { fetch, requests } = fakeFetch(() => messageResponse(SUGGESTION));
    await createAnthropicProvider({
      apiKey: "k",
      model: "claude-sonnet-5-5",
      fetch,
    }).suggestCategory(SUGGEST_INPUT);
    expect(requests[0]?.body.model).toBe("claude-sonnet-5-5");
  });
});
