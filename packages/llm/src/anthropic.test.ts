import type { SuggestCategoryInput } from "@denarii/core";
import { describe, expect, it, vi } from "vitest";
import { ANTHROPIC_DEFAULT_MODEL, createAnthropicProvider } from "./anthropic";
import { createLlmProvider } from "./index";

const food = { id: 1, name: "Food" };
const INPUT: SuggestCategoryInput = {
  merchant: "SHOWCASE CORDOBA",
  amountMinor: 1020000,
  currency: "ARS",
  paymentMethod: "Mercado Pago cuenta",
  categories: [{ id: 10, name: "Delivery", group: food }],
  groups: [food, { id: 2, name: "Leisure" }],
  examples: [
    {
      merchant: "PEDIDOSYA",
      amountMinor: 1500000,
      currency: "ARS",
      paymentMethod: null,
      category: { id: 10, name: "Delivery", group: food },
    },
  ],
};

/** A fake `fetch` that records requests and answers like the Messages API. No network. */
function fakeFetch(respond: () => Response | Promise<Response>) {
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    return respond();
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, requests };
}

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

describe("Anthropic provider", () => {
  it("asks claude-haiku-4-5 for structured output and maps it", async () => {
    const { fetch, requests } = fakeFetch(() =>
      messageResponse({
        category_id: null,
        new_category_name: "Cinema",
        group_id: 2,
        new_group_name: null,
      }),
    );
    const llm = createAnthropicProvider({ apiKey: "test-key", fetch });

    await expect(llm.suggestCategory(INPUT)).resolves.toEqual({
      categoryId: null,
      newCategoryName: "Cinema",
      groupId: 2,
      newGroupName: null,
    });

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request?.headers.get("x-api-key")).toBe("test-key");
    expect(request?.body).toMatchObject({
      model: "claude-haiku-4-5",
      output_config: { format: { type: "json_schema" } },
    });
    const prompt = JSON.stringify(request?.body.messages);
    for (const part of [
      "SHOWCASE CORDOBA",
      "$10,200.00 ARS",
      "Mercado Pago cuenta",
      "10: Delivery, Food",
      "2: Leisure",
      "PEDIDOSYA",
    ]) {
      expect(prompt).toContain(part);
    }
  });

  it("uses LLM_MODEL when set", async () => {
    const { fetch, requests } = fakeFetch(() =>
      messageResponse({
        category_id: 10,
        new_category_name: null,
        group_id: null,
        new_group_name: null,
      }),
    );
    await createAnthropicProvider({
      apiKey: "k",
      model: "claude-sonnet-5-5",
      fetch,
    }).suggestCategory(INPUT);
    expect(requests[0]?.body.model).toBe("claude-sonnet-5-5");
  });

  it("rejects on an API error without retrying", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fetch, requests } = fakeFetch(() =>
      Response.json(
        { type: "error", error: { type: "api_error", message: "boom" } },
        { status: 500 },
      ),
    );
    await expect(
      createAnthropicProvider({ apiKey: "k", fetch }).suggestCategory(INPUT),
    ).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });

  it("rejects when the call exceeds the timeout", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = ((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as typeof globalThis.fetch;
    const started = Date.now();
    await expect(
      createAnthropicProvider({ apiKey: "k", fetch, timeoutMs: 50 }).suggestCategory(INPUT),
    ).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe("createLlmProvider", () => {
  it("returns no provider for none", () => {
    expect(createLlmProvider({ LLM_PROVIDER: "none" })).toBeUndefined();
  });

  it("requires an API key for anthropic", () => {
    expect(() => createLlmProvider({ LLM_PROVIDER: "anthropic" })).toThrow(/ANTHROPIC_API_KEY/);
    expect(createLlmProvider({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" })).toBeDefined();
  });
});
