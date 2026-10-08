import type { Keyboard, Messenger } from "@denarii/core";

export function createTelegramMessenger(token: string, fetchFn: typeof fetch = fetch): Messenger {
  async function call<T>(method: string, params: object): Promise<T> {
    const response = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
    const body = (await response.json()) as { ok: boolean; description?: string; result?: T };
    if (!body.ok || body.result === undefined) {
      throw new Error(`Telegram ${method} failed (${response.status}): ${body.description ?? ""}`);
    }
    return body.result;
  }

  const replyMarkup = (keyboard: Keyboard | undefined) => ({
    inline_keyboard: (keyboard ?? []).map((row) =>
      row.map((b) => ({ text: b.text, callback_data: b.data })),
    ),
  });

  return {
    async send(chatId, text, keyboard) {
      const result = await call<{ message_id: number }>("sendMessage", {
        chat_id: chatId,
        text,
        ...(keyboard && { reply_markup: replyMarkup(keyboard) }),
      });
      return { messageId: result.message_id };
    },

    async edit(chatId, messageId, text, keyboard) {
      try {
        await call("editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text,
          reply_markup: replyMarkup(keyboard),
        });
      } catch (error) {
        // Re-rendering identical content (e.g. a double tap) is not a failure.
        if (!(error instanceof Error && error.message.includes("message is not modified"))) {
          throw error;
        }
      }
    },

    async answerCallback(callbackId, text) {
      await call("answerCallbackQuery", { callback_query_id: callbackId, text });
    },

    async acknowledge(chatId, messageId) {
      // ✅ is not an allowed Telegram reaction emoji; 👌 is the closest one that is.
      await call("setMessageReaction", {
        chat_id: chatId,
        message_id: messageId,
        reaction: [{ type: "emoji", emoji: "👌" }],
      });
    },
  };
}
