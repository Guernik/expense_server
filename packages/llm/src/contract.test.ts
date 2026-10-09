import type { LlmProvider } from "@denarii/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANTHROPIC_DEFAULT_MODEL, createAnthropicProvider } from "./anthropic";
import { createOpenAiProvider } from "./openai";
import { fakeFetch, NOTIFICATION, SUGGEST_INPUT } from "./testing";
import { createWorkersAiProvider, type WorkersAiBinding } from "./workers-ai";

/**
 * The shared contract every provider passes (ADR-0010): same operations, same mapping, and every
 * failure rejects so the core falls back to the manual path. Each harness fakes one provider's
 * wire format; nothing reaches the network.
 */
type Reply = { output: unknown } | "error" | "hang";

interface Harness {
  name: string;
  /** The provider answering every call with `reply`, and the text of each request it sent. */
  create(reply: Reply, timeoutMs?: number): { llm: LlmProvider; sent: () => string[] };
}

function fetchHarness(
  name: string,
  wire: (output: unknown) => Response,
  error: () => Response,
  make: (fetch: typeof globalThis.fetch, timeoutMs?: number) => LlmProvider,
): Harness {
  return {
    name,
    create(reply, timeoutMs) {
      const { fetch, requests } = fakeFetch(() =>
        reply === "hang" ? "hang" : reply === "error" ? error() : wire(reply.output),
      );
      return {
        llm: make(fetch, timeoutMs),
        sent: () => requests.map((r) => JSON.stringify(r.body)),
      };
    },
  };
}

const HARNESSES: Harness[] = [
  fetchHarness(
    "anthropic",
    (output) =>
      Response.json({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: ANTHROPIC_DEFAULT_MODEL,
        content: [{ type: "text", text: JSON.stringify(output) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    () =>
      Response.json(
        { type: "error", error: { type: "api_error", message: "boom" } },
        { status: 500 },
      ),
    (fetch, timeoutMs) =>
      createAnthropicProvider({ apiKey: "k", fetch, ...(timeoutMs && { timeoutMs }) }),
  ),
  fetchHarness(
    "openai",
    (output) =>
      Response.json({
        id: "chatcmpl-test",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: JSON.stringify(output), refusal: null },
          },
        ],
      }),
    () => Response.json({ error: { message: "boom", type: "server_error" } }, { status: 500 }),
    (fetch, timeoutMs) =>
      createOpenAiProvider({ apiKey: "k", model: "m", fetch, ...(timeoutMs && { timeoutMs }) }),
  ),
  fetchHarness(
    "workers-ai (REST)",
    (output) => Response.json({ success: true, errors: [], result: { response: output } }),
    () =>
      Response.json({ success: false, errors: [{ code: 7000, message: "boom" }] }, { status: 500 }),
    (fetch, timeoutMs) =>
      createWorkersAiProvider({
        model: "@cf/test/model",
        backend: { accountId: "acc", apiToken: "t", fetch },
        ...(timeoutMs && { timeoutMs }),
      }),
  ),
  {
    name: "workers-ai (binding)",
    create(reply, timeoutMs) {
      const inputs: Record<string, unknown>[] = [];
      const ai: WorkersAiBinding = {
        run: async (_model, input) => {
          inputs.push(input);
          if (reply === "hang") return new Promise(() => {});
          if (reply === "error") throw new Error("boom");
          return { response: reply.output };
        },
      };
      return {
        llm: createWorkersAiProvider({
          model: "@cf/test/model",
          backend: ai,
          ...(timeoutMs && { timeoutMs }),
        }),
        sent: () => inputs.map((i) => JSON.stringify(i)),
      };
    },
  },
];

describe.each(HARNESSES)("$name provider contract", (harness) => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("suggestCategory sends the purchase, taxonomy and examples and maps the output", async () => {
    const { llm, sent } = harness.create({
      output: { category_id: null, new_category_name: "Cinema", group_id: 2, new_group_name: null },
    });
    await expect(llm.suggestCategory(SUGGEST_INPUT)).resolves.toEqual({
      categoryId: null,
      newCategoryName: "Cinema",
      groupId: 2,
      newGroupName: null,
    });
    expect(sent()).toHaveLength(1);
    for (const part of [
      "SHOWCASE CORDOBA",
      "$10,200.00 ARS",
      "Mercado Pago cuenta",
      "10: Delivery, Food",
      "2: Leisure",
      "PEDIDOSYA",
    ]) {
      expect(sent()[0]).toContain(part);
    }
  });

  it("extractPurchase sends the notification and maps the output", async () => {
    const { llm, sent } = harness.create({
      output: {
        amount: "4250.50",
        currency: "ARS",
        merchant: "FARMACIA CENTRAL",
        payment_method: "Visa 1234",
        time: "14:05",
      },
    });
    await expect(llm.extractPurchase(NOTIFICATION)).resolves.toEqual({
      amount: "4250.50",
      currency: "ARS",
      merchant: "FARMACIA CENTRAL",
      paymentMethod: "Visa 1234",
      time: "14:05",
    });
    expect(sent()[0]).toContain("Compraste con tu tarjeta");
    expect(sent()[0]).toContain("FARMACIA CENTRAL con Visa 1234");
  });

  it("proposeRule sends the confirmed fields and maps the currency map", async () => {
    const { llm, sent } = harness.create({
      output: {
        title: "^Compraste con tu tarjeta$",
        text: "^Pagaste (?<currency>\\$) (?<amount>[\\d.,]+) en (?<merchant>.+)$",
        number_format: "es-AR",
        currency_map: [{ token: "$", currency: "ARS" }],
        default_currency: null,
        payment_method: null,
        merchant: null,
      },
    });
    const output = await llm.proposeRule({
      ...NOTIFICATION,
      confirmed: {
        amount: "4250.5",
        currency: "ARS",
        merchant: "FARMACIA CENTRAL",
        paymentMethod: null,
        time: "14:05",
      },
    });
    expect(output).toEqual({
      title: "^Compraste con tu tarjeta$",
      text: "^Pagaste (?<currency>\\$) (?<amount>[\\d.,]+) en (?<merchant>.+)$",
      numberFormat: "es-AR",
      currencyMap: { $: "ARS" },
      defaultCurrency: null,
      paymentMethod: null,
      merchant: null,
    });
    for (const part of ["amount: 4250.5", "merchant: FARMACIA CENTRAL", "payment method: none"]) {
      expect(sent()[0]).toContain(part);
    }
  });

  it("rejects on an API error without retrying", async () => {
    const { llm, sent } = harness.create("error");
    await expect(llm.suggestCategory(SUGGEST_INPUT)).rejects.toThrow();
    await expect(llm.extractPurchase(NOTIFICATION)).rejects.toThrow();
    expect(sent()).toHaveLength(2);
  });

  it("rejects output that doesn't match the schema", async () => {
    const { llm } = harness.create({ output: { amount: 4250.5, currency: "EUR" } });
    await expect(llm.extractPurchase(NOTIFICATION)).rejects.toThrow();
  });

  it("rejects when the call exceeds the timeout", async () => {
    const { llm } = harness.create("hang", 50);
    const started = Date.now();
    await expect(llm.suggestCategory(SUGGEST_INPUT)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
