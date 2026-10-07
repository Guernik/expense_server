import type { Messenger } from "@denarii/core";

export function createTelegramMessenger(token: string, fetchFn: typeof fetch = fetch): Messenger {
  return {
    async send(chatId, text) {
      const response = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      const body = (await response.json()) as {
        ok: boolean;
        description?: string;
        result?: { message_id: number };
      };
      if (!body.ok || !body.result) {
        throw new Error(
          `Telegram sendMessage failed (${response.status}): ${body.description ?? ""}`,
        );
      }
      return { messageId: body.result.message_id };
    },
  };
}
