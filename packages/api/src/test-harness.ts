import { type Keyboard, type LlmProvider, MAX_CALLBACK_BYTES, type Messenger } from "@denarii/core";
import { createStore } from "@denarii/db";
import { createTestDatabase } from "@denarii/db/testing";
import { createApp, type Runtime } from "./app";
import { parseConfig } from "./config";

export const WEBHOOK_SECRET = "test-webhook-secret-0123";
export const TELEGRAM_SECRET = "test-telegram-secret-0123";
export const CHAT_ID = 42;

export interface FakeMessage {
  messageId: number;
  chatId: string;
  text: string;
  keyboard?: Keyboard;
}

/** Records bot messages as Telegram would show them: edits replace text and keyboard in place. */
function createFakeMessenger() {
  const messages: FakeMessage[] = [];
  const toasts: (string | undefined)[] = [];
  const checkKeyboard = (keyboard?: Keyboard) => {
    for (const button of keyboard?.flat() ?? []) {
      if (new TextEncoder().encode(button.data).length >= MAX_CALLBACK_BYTES) {
        throw new Error(`callback_data too long: ${button.data}`);
      }
    }
  };
  const messenger: Messenger = {
    async send(chatId, text, keyboard) {
      checkKeyboard(keyboard);
      const messageId = 1001 + messages.length;
      messages.push({ messageId, chatId, text, ...(keyboard && { keyboard }) });
      return { messageId };
    },
    async edit(chatId, messageId, text, keyboard) {
      checkKeyboard(keyboard);
      const index = messages.findIndex((m) => m.messageId === messageId && m.chatId === chatId);
      if (index === -1) throw new Error(`No message ${messageId}`);
      messages[index] = { messageId, chatId, text, ...(keyboard && { keyboard }) };
    },
    async answerCallback(_callbackId, text) {
      toasts.push(text);
    },
  };
  return { messenger, messages, toasts };
}

export function setup(locale: "en" | "es" = "es", options: { llm?: LlmProvider } = {}) {
  const db = createTestDatabase();
  const { messenger, messages, toasts } = createFakeMessenger();
  const clock = { current: new Date("2026-10-07T01:32:10Z") };
  const tasks: Promise<unknown>[] = [];
  const runtime: Runtime = {
    config: parseConfig({
      WEBHOOK_SECRET,
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_CHAT_ID: String(CHAT_ID),
      TELEGRAM_WEBHOOK_SECRET: TELEGRAM_SECRET,
      RULE_PACKS: "ar.galicia,ar.mercadopago",
      LOCALE: locale,
    }),
    store: createStore(db),
    messenger,
    clock: { now: () => clock.current },
    llm: options.llm,
    defer: (task) => tasks.push(task),
  };
  const app = createApp(() => runtime);
  const settled = () => Promise.all(tasks);

  const ingest = (body: unknown, secret = WEBHOOK_SECRET) =>
    app.request("/api/ingest", {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": secret },
      body: JSON.stringify(body),
    });
  const telegram = (update: unknown, secret = TELEGRAM_SECRET) =>
    app.request("/api/telegram", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
      body: JSON.stringify(update),
    });

  let callbackIds = 0;
  /** Taps the button labelled `text` on the given bot message. */
  const tap = async (message: FakeMessage | undefined, text: string, chatId = CHAT_ID) => {
    const current = messages.find((m) => m.messageId === message?.messageId);
    const button = current?.keyboard?.flat().find((b) => b.text === text);
    if (!current || !button) {
      throw new Error(`No button "${text}" on ${JSON.stringify(current ?? message)}`);
    }
    const response = await telegram({
      callback_query: {
        id: String(++callbackIds),
        data: button.data,
        message: { message_id: current.messageId, chat: { id: chatId } },
      },
    });
    if (response.status !== 200) throw new Error(`Webhook returned ${response.status}`);
  };
  /** The user types a message in the chat. */
  const say = (text: string, chatId = CHAT_ID) =>
    telegram({ message: { chat: { id: chatId }, text } });
  const message = (messageId: number | undefined) =>
    messages.find((m) => m.messageId === messageId);
  const buttons = (m: FakeMessage | undefined) =>
    message(m?.messageId)?.keyboard?.map((row) => row.map((b) => b.text));

  return {
    app,
    db,
    runtime,
    clock,
    messages,
    toasts,
    ingest,
    telegram,
    settled,
    tap,
    say,
    message,
    buttons,
  };
}

export const GALICIA_PURCHASE = {
  app: "Galicia",
  title: "Pagaste $15.000,01",
  text: "A AXION VILLA ALLENDE con tu Visa Crédito 3551 a las 22:32.",
};
