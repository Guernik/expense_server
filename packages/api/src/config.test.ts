import { describe, expect, it } from "vitest";
import { parseConfig } from "./config";

const BASE = {
  WEBHOOK_SECRET: "test-webhook-secret-0123",
  TELEGRAM_BOT_TOKEN: "token",
  TELEGRAM_CHAT_ID: "42",
  TELEGRAM_WEBHOOK_SECRET: "test-telegram-secret-0123",
  RULE_PACKS: "ar.galicia",
};

describe("LLM config", () => {
  it("defaults to LLM_PROVIDER=none", () => {
    expect(parseConfig(BASE).LLM_PROVIDER).toBe("none");
  });

  it("requires ANTHROPIC_API_KEY for anthropic", () => {
    expect(() => parseConfig({ ...BASE, LLM_PROVIDER: "anthropic" })).toThrow(/ANTHROPIC_API_KEY/);
    expect(
      parseConfig({ ...BASE, LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k", LLM_MODEL: "m" }),
    ).toMatchObject({ LLM_PROVIDER: "anthropic", LLM_MODEL: "m" });
  });

  it("requires OPENAI_API_KEY and LLM_MODEL for openai", () => {
    expect(() => parseConfig({ ...BASE, LLM_PROVIDER: "openai", LLM_MODEL: "m" })).toThrow(
      /OPENAI_API_KEY/,
    );
    expect(() => parseConfig({ ...BASE, LLM_PROVIDER: "openai", OPENAI_API_KEY: "k" })).toThrow(
      /LLM_MODEL/,
    );
    expect(
      parseConfig({
        ...BASE,
        LLM_PROVIDER: "openai",
        OPENAI_API_KEY: "k",
        LLM_MODEL: "m",
        OPENAI_BASE_URL: "http://localhost:11434/v1",
      }),
    ).toMatchObject({ LLM_PROVIDER: "openai", OPENAI_BASE_URL: "http://localhost:11434/v1" });
    expect(() =>
      parseConfig({
        ...BASE,
        LLM_PROVIDER: "openai",
        OPENAI_API_KEY: "k",
        LLM_MODEL: "m",
        OPENAI_BASE_URL: "not a url",
      }),
    ).toThrow(/OPENAI_BASE_URL/);
  });

  it("requires LLM_MODEL for workers-ai", () => {
    expect(() => parseConfig({ ...BASE, LLM_PROVIDER: "workers-ai" })).toThrow(/LLM_MODEL/);
    expect(
      parseConfig({ ...BASE, LLM_PROVIDER: "workers-ai", LLM_MODEL: "@cf/m", CF_ACCOUNT_ID: "a" }),
    ).toMatchObject({ LLM_PROVIDER: "workers-ai", CF_ACCOUNT_ID: "a" });
  });

  it("rejects unknown providers", () => {
    expect(() => parseConfig({ ...BASE, LLM_PROVIDER: "gemini" })).toThrow(/LLM_PROVIDER/);
  });
});
