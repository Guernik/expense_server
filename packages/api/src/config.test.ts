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

describe("Telegram mode", () => {
  const { TELEGRAM_WEBHOOK_SECRET: _, ...noSecret } = BASE;

  it("defaults to webhook, which requires TELEGRAM_WEBHOOK_SECRET", () => {
    expect(parseConfig(BASE).TELEGRAM_MODE).toBe("webhook");
    expect(() => parseConfig(noSecret)).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
  });

  it("does not need a webhook secret for polling", () => {
    expect(parseConfig({ ...noSecret, TELEGRAM_MODE: "polling" })).toMatchObject({
      TELEGRAM_MODE: "polling",
    });
  });

  it("rejects unknown modes", () => {
    expect(() => parseConfig({ ...BASE, TELEGRAM_MODE: "push" })).toThrow(/TELEGRAM_MODE/);
  });
});
