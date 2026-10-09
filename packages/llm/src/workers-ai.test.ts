import { describe, expect, it, vi } from "vitest";
import { fakeFetch, SUGGEST_INPUT } from "./testing";
import { createWorkersAiProvider, type WorkersAiBinding } from "./workers-ai";

/** Workers AI wire details. Behavior shared by every provider is in contract.test.ts. */
const SUGGESTION = {
  category_id: 10,
  new_category_name: null,
  group_id: null,
  new_group_name: null,
};

describe("Workers AI provider", () => {
  it("runs the model on the AI binding in JSON mode", async () => {
    const run = vi.fn<WorkersAiBinding["run"]>(async () => ({ response: SUGGESTION }));
    await expect(
      createWorkersAiProvider({ model: "@cf/meta/test", backend: { run } }).suggestCategory(
        SUGGEST_INPUT,
      ),
    ).resolves.toMatchObject({ categoryId: 10 });

    expect(run).toHaveBeenCalledOnce();
    const [model, inputs] = run.mock.calls[0] ?? [];
    expect(model).toBe("@cf/meta/test");
    expect(inputs).toMatchObject({
      messages: [{ role: "system" }, { role: "user" }],
      response_format: {
        type: "json_schema",
        json_schema: { type: "object", required: expect.arrayContaining(["category_id"]) },
      },
    });
  });

  it("accepts a response given as a JSON string", async () => {
    const run = async () => ({ response: JSON.stringify(SUGGESTION) });
    await expect(
      createWorkersAiProvider({ model: "m", backend: { run } }).suggestCategory(SUGGEST_INPUT),
    ).resolves.toMatchObject({ categoryId: 10 });
  });

  it("calls the REST API with the account id and token on Node", async () => {
    const { fetch, requests } = fakeFetch(() =>
      Response.json({ success: true, errors: [], result: { response: SUGGESTION } }),
    );
    await createWorkersAiProvider({
      model: "@cf/meta/test",
      backend: { accountId: "acc123", apiToken: "cf-token", fetch },
    }).suggestCategory(SUGGEST_INPUT);

    expect(requests[0]?.url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acc123/ai/run/@cf/meta/test",
    );
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer cf-token");
    expect(requests[0]?.body).toMatchObject({ response_format: { type: "json_schema" } });
  });

  it("rejects a REST error body", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fetch } = fakeFetch(() =>
      Response.json({ success: false, errors: [{ code: 5007, message: "No such model" }] }),
    );
    await expect(
      createWorkersAiProvider({
        model: "m",
        backend: { accountId: "a", apiToken: "t", fetch },
      }).suggestCategory(SUGGEST_INPUT),
    ).rejects.toThrow(/No such model/);
  });
});
