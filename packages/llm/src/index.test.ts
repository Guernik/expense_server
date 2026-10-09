import { describe, expect, it } from "vitest";
import { createLlmProvider } from "./index";

describe("createLlmProvider", () => {
  it("returns no provider for none", () => {
    expect(createLlmProvider({ LLM_PROVIDER: "none" })).toBeUndefined();
  });

  it("requires an API key for anthropic", () => {
    expect(() => createLlmProvider({ LLM_PROVIDER: "anthropic" })).toThrow(/ANTHROPIC_API_KEY/);
    expect(createLlmProvider({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" })).toBeDefined();
  });

  it("requires an API key and a model for openai", () => {
    expect(() => createLlmProvider({ LLM_PROVIDER: "openai", LLM_MODEL: "m" })).toThrow(
      /OPENAI_API_KEY/,
    );
    expect(() => createLlmProvider({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "k" })).toThrow(
      /LLM_MODEL/,
    );
    expect(
      createLlmProvider({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "k", LLM_MODEL: "m" }),
    ).toBeDefined();
  });

  it("uses the AI binding or REST credentials for workers-ai", () => {
    const config = { LLM_PROVIDER: "workers-ai", LLM_MODEL: "@cf/m" } as const;
    expect(() => createLlmProvider(config)).toThrow(/CF_ACCOUNT_ID/);
    expect(createLlmProvider(config, { ai: { run: async () => ({}) } })).toBeDefined();
    expect(createLlmProvider({ ...config, CF_ACCOUNT_ID: "a", CF_API_TOKEN: "t" })).toBeDefined();
    expect(() => createLlmProvider({ LLM_PROVIDER: "workers-ai" })).toThrow(/LLM_MODEL/);
  });
});
