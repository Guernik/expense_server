import { describe, expect, it, vi } from "vitest";
import { createOpenAiProvider } from "./openai";
import { fakeFetch, SUGGEST_INPUT } from "./testing";

/** OpenAI wire details. Behavior shared by every provider is in contract.test.ts. */
function completion(message: Record<string, unknown>, finishReason = "stop") {
  return Response.json({
    id: "chatcmpl-test",
    object: "chat.completion",
    choices: [
      { index: 0, finish_reason: finishReason, message: { role: "assistant", ...message } },
    ],
  });
}

const SUGGESTION = {
  category_id: 10,
  new_category_name: null,
  group_id: null,
  new_group_name: null,
};

describe("OpenAI provider", () => {
  it("calls Chat Completions with a strict JSON Schema response format", async () => {
    const { fetch, requests } = fakeFetch(() =>
      completion({ content: JSON.stringify(SUGGESTION) }),
    );
    await createOpenAiProvider({ apiKey: "sk-test", model: "gpt-test", fetch }).suggestCategory(
      SUGGEST_INPUT,
    );

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(request?.headers.get("authorization")).toBe("Bearer sk-test");
    expect(request?.body).toMatchObject({
      model: "gpt-test",
      messages: [{ role: "system" }, { role: "user" }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "suggestCategory",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["category_id", "new_category_name", "group_id", "new_group_name"],
          },
        },
      },
    });
    expect(JSON.stringify(request?.body)).not.toContain("$schema");
  });

  it("uses OPENAI_BASE_URL for compatible endpoints", async () => {
    const { fetch, requests } = fakeFetch(() =>
      completion({ content: JSON.stringify(SUGGESTION) }),
    );
    await createOpenAiProvider({
      apiKey: "k",
      model: "llama3.2",
      baseUrl: "http://localhost:11434/v1/",
      fetch,
    }).suggestCategory(SUGGEST_INPUT);
    expect(requests[0]?.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(requests[0]?.body.model).toBe("llama3.2");
  });

  it("rejects a refusal", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fetch } = fakeFetch(() => completion({ content: null, refusal: "no" }));
    await expect(
      createOpenAiProvider({ apiKey: "k", model: "m", fetch }).suggestCategory(SUGGEST_INPUT),
    ).rejects.toThrow(/refusal no/);
  });
});
