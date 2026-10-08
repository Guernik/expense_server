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

  it("rejects providers that aren't implemented yet", () => {
    expect(() => parseConfig({ ...BASE, LLM_PROVIDER: "openai" })).toThrow(/LLM_PROVIDER/);
  });
});
