import { describe, expect, it, vi } from "vitest";
import { createFakeTelegram } from "./fake-telegram";
import { pollTelegram } from "./polling";

describe("pollTelegram", () => {
  it("advances the offset past each update, even when handling one fails", async () => {
    const telegram = createFakeTelegram();
    const handled: unknown[] = [];
    const abort = new AbortController();
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const polling = pollTelegram({
      token: "token",
      fetch: telegram.fetch,
      signal: abort.signal,
      onUpdate: async (update) => {
        handled.push(update);
        if (handled.length === 1) throw new Error("boom");
      },
    });
    telegram.push({ message: { text: "a" } });
    telegram.push({ message: { text: "b" } });
    await vi.waitFor(() => expect(handled).toHaveLength(2));
    telegram.push({ message: { text: "c" } });
    await vi.waitFor(() => expect(handled).toHaveLength(3));
    abort.abort();
    await polling;

    expect(handled.map((u) => (u as { update_id: number }).update_id)).toEqual([1, 2, 3]);
    expect(errors).toHaveBeenCalledWith("Telegram update 1 failed", expect.any(Error));
    errors.mockRestore();
  });

  it("retries after a failed getUpdates", async () => {
    const telegram = createFakeTelegram();
    let failures = 1;
    const flaky: typeof fetch = (input, init) => {
      if (String(input).endsWith("/getUpdates") && failures-- > 0) {
        return Promise.reject(new Error("network down"));
      }
      return telegram.fetch(input, init);
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const abort = new AbortController();
    const handled: unknown[] = [];
    const polling = pollTelegram({
      token: "token",
      fetch: flaky,
      signal: abort.signal,
      retryMs: 1,
      onUpdate: async (update) => void handled.push(update),
    });
    telegram.push({ message: { text: "a" } });
    await vi.waitFor(() => expect(handled).toHaveLength(1));
    abort.abort();
    await polling;
    expect(errors).toHaveBeenCalledWith("Telegram getUpdates failed, retrying", expect.any(Error));
    errors.mockRestore();
  });
});
