import { dedupeWindow } from "../dedupe";
import { INTL_LOCALE, t } from "../i18n";
import { formatMoney } from "../money";
import { normalizeMerchant, normalizeText } from "../normalize";
import type {
  Category,
  ChatState,
  Clock,
  Messenger,
  Store,
  StoredEvent,
  StoredPurchase,
  User,
} from "../ports";
import { UNKNOWN_MERCHANT } from "../rules/engine";
import { ignoreSimilarRule, similarMatch } from "../rules/ignore-similar";
import { type Action, decodeAction } from "./callback-data";
import { type Command, parseCommand, splitSetGroupArgs } from "./commands";
import { parseManualPurchase } from "./manual-purchase";
import {
  categoryLabel,
  confirmationKeyboard,
  confirmationText,
  confirmRuleKeyboard,
  excludedText,
  groupKeyboard,
  ignoreSimilarKeyboard,
  morePageKeyboard,
  pickerKeyboard,
  pickerText,
  TOP_CATEGORIES,
  unmatchedKeyboard,
  unmatchedText,
} from "./views";

export interface BotDeps {
  store: Store;
  messenger: Messenger;
  clock: Clock;
}

/** What the bot receives from the configured chat, independent of the messenger. */
export type BotInput =
  /** `replyToMessageId` is set when the user replied to one of the bot's messages. */
  | { kind: "text"; text: string; messageId: number; replyToMessageId?: number }
  | { kind: "callback"; callbackId: string; messageId: number; data: string };

export const MAX_NAME_LENGTH = 40;
const UNKNOWN_MERCHANT_NORMALIZED = normalizeMerchant(UNKNOWN_MERCHANT);
const CHAT_STATE_TTL_MS = 15 * 60_000;
const TOP_WINDOW_MS = 90 * 24 * 60 * 60_000;
export const MAX_PENDING_PROMPTS = 10;

/** Transfers and the reserved `Unknown` merchant never match or create merchant rules. */
export function canHaveMerchantRule(purchase: StoredPurchase): boolean {
  return (
    purchase.kind === "purchase" && purchase.merchantNormalized !== UNKNOWN_MERCHANT_NORMALIZED
  );
}

/**
 * First message for a new purchase (SPEC §7.1): categorized silently with a ✅ confirmation when a
 * merchant rule matches, otherwise the category picker.
 */
export async function announcePurchase(
  deps: BotDeps,
  user: User,
  purchase: StoredPurchase,
): Promise<void> {
  const { store, messenger } = deps;
  const category = canHaveMerchantRule(purchase)
    ? await store.findMerchantRule(user.id, purchase.merchantNormalized)
    : null;

  let sent: { messageId: number };
  if (category) {
    await store.categorizePurchase(purchase.id, category.id, "rule");
    sent = await messenger.send(
      user.telegramChatId,
      confirmationText(user, purchase, category),
      confirmationKeyboard(user.locale, purchase.id),
    );
  } else {
    sent = await messenger.send(
      user.telegramChatId,
      pickerText(user, purchase),
      pickerKeyboard(user.locale, purchase.id, await topCategories(deps, user)),
    );
  }
  await store.setPurchaseTelegramMessage(purchase.id, sent.messageId);
}

/** SPEC §7.4: the transfer notice. */
export async function announceTransfer(
  deps: BotDeps,
  user: User,
  purchase: StoredPurchase,
): Promise<void> {
  const intlLocale = INTL_LOCALE[user.locale];
  const time = new Intl.DateTimeFormat(intlLocale, {
    timeZone: user.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(purchase.occurredAt);
  const amount = formatMoney(purchase.amountMinor, purchase.currency, intlLocale);
  const { messageId } = await deps.messenger.send(
    user.telegramChatId,
    t(user.locale, "transferNotice", { amount, time }),
  );
  await deps.store.setPurchaseTelegramMessage(purchase.id, messageId);
}

/** SPEC §7.3: asks whether an event no rule matched is a purchase. */
export async function announceUnmatched(
  deps: BotDeps,
  user: User,
  event: StoredEvent,
): Promise<void> {
  await deps.messenger.send(
    user.telegramChatId,
    unmatchedText(user, event),
    unmatchedKeyboard(user.locale, event.id),
  );
}

export async function handleBotInput(deps: BotDeps, user: User, input: BotInput): Promise<void> {
  if (input.kind === "callback") await handleCallback(deps, user, input);
  else await handleText(deps, user, input);
}

async function handleCallback(
  deps: BotDeps,
  user: User,
  input: Extract<BotInput, { kind: "callback" }>,
): Promise<void> {
  const { store, messenger, clock } = deps;
  const chatId = user.telegramChatId;
  const answer = (text?: string) => messenger.answerCallback(input.callbackId, text);

  const action = decodeAction(input.data);
  if (!action || action.type === "noop") return answer();
  if ("eventId" in action) {
    await handleEventCallback(deps, user, input.messageId, action);
    return answer();
  }
  const purchase = await store.getPurchase(user.id, action.purchaseId);
  if (!purchase) return answer();

  switch (action.type) {
    case "pick": {
      const category = await store.getCategory(user.id, action.categoryId);
      if (!category) return answer();
      await store.clearChatState(chatId);
      await applyCategory(deps, user, purchase, category, input.messageId);
      return answer();
    }
    case "picker":
      await messenger.edit(
        chatId,
        input.messageId,
        pickerText(user, purchase),
        pickerKeyboard(user.locale, purchase.id, await topCategories(deps, user)),
      );
      return answer();
    case "more":
      await messenger.edit(
        chatId,
        input.messageId,
        pickerText(user, purchase),
        morePageKeyboard(
          user.locale,
          purchase.id,
          await store.listCategories(user.id),
          action.page,
        ),
      );
      return answer();
    case "notPurchase": {
      await store.clearChatState(chatId);
      await store.excludePurchase(purchase.id);
      const event = await store.findPurchaseEvent(user.id, purchase.id);
      await messenger.edit(
        chatId,
        input.messageId,
        excludedText(user, purchase),
        event ? ignoreSimilarKeyboard(user.locale, event.id) : undefined,
      );
      return answer();
    }
    case "skip":
      await store.clearChatState(chatId);
      await messenger.edit(chatId, input.messageId, pickerText(user, purchase));
      return answer(t(user.locale, "skipped"));
    case "newCategory":
      await setState(deps, user, { step: "awaiting_category_name", purchaseId: purchase.id });
      await messenger.send(
        chatId,
        t(user.locale, "askCategoryName", { merchant: purchase.merchantRaw }),
      );
      return answer();
    case "group":
    case "newGroup": {
      const state = await store.getChatState(chatId, clock.now());
      if (state?.step !== "awaiting_group_name" || state.purchaseId !== purchase.id) {
        return answer(t(user.locale, "expired"));
      }
      if (action.type === "newGroup") {
        await setState(deps, user, state);
        await messenger.send(
          chatId,
          t(user.locale, "askGroupName", { category: state.categoryName }),
        );
        return answer();
      }
      const group = (await store.listGroups(user.id)).find((g) => g.id === action.groupId);
      if (!group) return answer();
      const category = await ensureCategory(deps, user, state.categoryName, group.id);
      await store.clearChatState(chatId);
      await messenger.edit(chatId, input.messageId, `✅ ${categoryLabel(category)}`);
      await applyCategory(deps, user, purchase, category, purchase.telegramMessageId);
      return answer();
    }
  }
}

/** PURCHASE / NON-PURCHASE on an unmatched event, and "Ignore similar" (SPEC §7.3). */
async function handleEventCallback(
  deps: BotDeps,
  user: User,
  messageId: number,
  action: Extract<Action, { eventId: number }>,
): Promise<void> {
  const { store, messenger } = deps;
  const { locale, telegramChatId: chatId } = user;
  const event = await store.getEvent(user.id, action.eventId);
  if (!event) return;

  if (action.type === "eventPurchase" || action.type === "eventNonPurchase") {
    if (event.status !== "unmatched") return;
    if (action.type === "eventPurchase") {
      await setState(deps, user, {
        step: "awaiting_manual_extraction",
        eventId: event.id,
        messageId,
      });
      await messenger.send(chatId, t(locale, "askManualPurchase"));
      return;
    }
    await store.classifyEvent(event.id, { status: "non_purchase" });
    await messenger.edit(
      chatId,
      messageId,
      answeredText(user, event, "eventNonPurchase"),
      ignoreSimilarKeyboard(locale, event.id),
    );
    return;
  }

  const base = await notPurchaseText(deps, user, event);
  if (base === null) return;
  switch (action.type) {
    case "ignoreSimilar": {
      const match = similarMatch(event);
      const [field, pattern] =
        "title" in match
          ? (["fieldTitle", match.title] as const)
          : (["fieldText", match.text] as const);
      const prompt = t(locale, "confirmIgnoreRule", { field: t(locale, field), pattern });
      await messenger.edit(
        chatId,
        messageId,
        `${base}\n\n${prompt}`,
        confirmRuleKeyboard(locale, event.id),
      );
      return;
    }
    case "confirmRule": {
      const rule = ignoreSimilarRule(event);
      const key = JSON.stringify(rule.match);
      const existing = await store.listUserRules(user.id);
      if (!existing.some((r) => r.kind === "ignore" && JSON.stringify(r.match) === key)) {
        await store.insertUserRule(user.id, rule, event.id);
      }
      await messenger.edit(chatId, messageId, `${base}\n\n${t(locale, "ignoreRuleSaved")}`);
      return;
    }
    case "cancelRule":
      await messenger.edit(chatId, messageId, base);
      return;
  }
}

/**
 * The message of an event the user said is not a purchase: NON-PURCHASE on an unmatched event, or
 * `🚫 Not a purchase` on its purchase. Null when neither happened, so "Ignore similar" is refused.
 */
async function notPurchaseText(
  deps: BotDeps,
  user: User,
  event: StoredEvent,
): Promise<string | null> {
  if (event.status === "non_purchase") return answeredText(user, event, "eventNonPurchase");
  if (event.purchaseId === null) return null;
  const purchase = await deps.store.getPurchase(user.id, event.purchaseId);
  return purchase?.status === "excluded" ? excludedText(user, purchase) : null;
}

/** The unmatched notice followed by the user's answer. */
function answeredText(
  user: User,
  event: StoredEvent,
  answer: "eventPurchase" | "eventNonPurchase",
): string {
  return `${unmatchedText(user, event)}\n\n${t(user.locale, answer)}`;
}

/** `<amount> <merchant>` after PURCHASE: creates the purchase, then the normal category flow. */
async function handleManualPurchase(
  deps: BotDeps,
  user: User,
  state: Extract<ChatState, { step: "awaiting_manual_extraction" }>,
  text: string,
): Promise<void> {
  const { store, messenger } = deps;
  const chatId = user.telegramChatId;
  const event = await store.getEvent(user.id, state.eventId);
  if (event?.status !== "unmatched") {
    await store.clearChatState(chatId);
    return;
  }
  const parsed = parseManualPurchase(text, user.locale);
  if (!parsed) {
    await setState(deps, user, state);
    await messenger.send(chatId, t(user.locale, "manualPurchaseInvalid"));
    return;
  }

  await store.clearChatState(chatId);
  const inserted = await store.insertPurchase(
    {
      userId: user.id,
      kind: "purchase",
      occurredAt: event.receivedAt,
      amountMinor: parsed.amountMinor,
      currency: parsed.currency,
      merchantRaw: parsed.merchant,
      merchantNormalized: normalizeMerchant(parsed.merchant),
      paymentMethodId: null,
      sourceEventId: event.id,
    },
    dedupeWindow(event.receivedAt),
  );
  const { purchase } = inserted;
  await store.classifyEvent(event.id, {
    status: inserted.created ? "purchase" : "duplicate",
    purchaseId: purchase.id,
    extractedBy: "user",
  });
  await messenger.edit(chatId, state.messageId, answeredText(user, event, "eventPurchase"));
  if (inserted.created) await announcePurchase(deps, user, purchase);
}

async function handleText(
  deps: BotDeps,
  user: User,
  input: Extract<BotInput, { kind: "text" }>,
): Promise<void> {
  const { store, messenger, clock } = deps;
  const chatId = user.telegramChatId;
  const { text } = input;
  const command = parseCommand(text);
  if (command) {
    await handleCommand(deps, user, command);
    return;
  }
  if (input.replyToMessageId !== undefined) {
    const replied = await store.findPurchaseByTelegramMessage(user.id, input.replyToMessageId);
    const comment = text.trim();
    if (replied && comment) {
      await store.setPurchaseComment(replied.id, comment);
      await messenger.acknowledge(chatId, input.messageId);
      return;
    }
  }

  const state = await store.getChatState(chatId, clock.now());
  const name = normalizeText(text);
  if (!state || !name || name.startsWith("/")) return;
  if (state.step === "awaiting_manual_extraction") {
    await handleManualPurchase(deps, user, state, text);
    return;
  }
  if ([...name].length > MAX_NAME_LENGTH) {
    await messenger.send(chatId, t(user.locale, "nameTooLong", { max: String(MAX_NAME_LENGTH) }));
    return;
  }
  const purchase = await store.getPurchase(user.id, state.purchaseId);
  if (!purchase) {
    await store.clearChatState(chatId);
    return;
  }

  if (state.step === "awaiting_category_name") {
    const existing = await store.findCategoryByName(user.id, name);
    if (existing) {
      await store.clearChatState(chatId);
      await applyCategory(deps, user, purchase, existing, purchase.telegramMessageId);
      return;
    }
    await setState(deps, user, {
      step: "awaiting_group_name",
      purchaseId: purchase.id,
      categoryName: name,
    });
    await messenger.send(
      chatId,
      t(user.locale, "askGroup", { category: name }),
      groupKeyboard(user.locale, purchase.id, await store.listGroups(user.id)),
    );
    return;
  }

  const group = await store.ensureGroup(user.id, name);
  const category = await ensureCategory(deps, user, state.categoryName, group.id);
  await store.clearChatState(chatId);
  await applyCategory(deps, user, purchase, category, purchase.telegramMessageId);
}

/** SPEC §7.5. Unknown commands are ignored. */
async function handleCommand(deps: BotDeps, user: User, command: Command): Promise<void> {
  const { messenger } = deps;
  const { locale, telegramChatId: chatId } = user;
  switch (command.name) {
    case "start":
      await messenger.send(chatId, t(locale, "start"));
      return;
    case "help":
      await messenger.send(chatId, t(locale, "help"));
      return;
    case "pending":
      await resendPending(deps, user);
      return;
    case "setgroup":
      await setGroup(deps, user, command.args);
      return;
  }
}

/** Re-sends the prompt of the oldest pending purchases and transfers. */
async function resendPending(deps: BotDeps, user: User): Promise<void> {
  const pending = await deps.store.listPendingPurchases(user.id, MAX_PENDING_PROMPTS);
  if (pending.length === 0) {
    await deps.messenger.send(user.telegramChatId, t(user.locale, "nothingPending"));
    return;
  }
  for (const purchase of pending) {
    if (purchase.kind === "transfer") {
      await announceTransfer(deps, user, purchase);
      continue;
    }
    const { messageId } = await deps.messenger.send(
      user.telegramChatId,
      pickerText(user, purchase),
      pickerKeyboard(user.locale, purchase.id, await topCategories(deps, user)),
    );
    await deps.store.setPurchaseTelegramMessage(purchase.id, messageId);
  }
}

/** `/setgroup <category> <group>`: moves the category, creating the group if missing. */
async function setGroup(deps: BotDeps, user: User, args: string): Promise<void> {
  const { store, messenger } = deps;
  const { locale, telegramChatId: chatId } = user;
  const words = normalizeText(args).split(" ").filter(Boolean);
  if (words.length < 2) {
    await messenger.send(chatId, t(locale, "setGroupUsage"));
    return;
  }
  const categories = await store.listCategories(user.id);
  const split = splitSetGroupArgs(words.join(" "), (name) =>
    categories.find((c) => c.name.toLowerCase() === name.toLowerCase()),
  );
  if (!split) {
    const name = words.slice(0, -1).join(" ");
    await messenger.send(chatId, t(locale, "unknownCategory", { name }));
    return;
  }
  if ([...split.group].length > MAX_NAME_LENGTH) {
    await messenger.send(chatId, t(locale, "nameTooLong", { max: String(MAX_NAME_LENGTH) }));
    return;
  }
  const group = await store.ensureGroup(user.id, split.group);
  await store.setCategoryGroup(split.category.id, group.id);
  await messenger.send(
    chatId,
    t(locale, "categoryMoved", { category: split.category.name, group: group.name }),
  );
}

/**
 * Categorizes the purchase, creates or updates its merchant rule, and turns the purchase message
 * into the ✅ confirmation.
 */
async function applyCategory(
  deps: BotDeps,
  user: User,
  purchase: StoredPurchase,
  category: Category,
  messageId: number | null,
): Promise<void> {
  const { store, messenger } = deps;
  await store.categorizePurchase(purchase.id, category.id, "user");
  if (canHaveMerchantRule(purchase)) {
    await store.upsertMerchantRule(user.id, purchase.merchantNormalized, category.id, "user");
  }
  if (messageId !== null) {
    await messenger.edit(
      user.telegramChatId,
      messageId,
      confirmationText(user, purchase, category),
      confirmationKeyboard(user.locale, purchase.id),
    );
  }
}

/** Reuses a category with the same name (case-insensitive) if it already exists. */
async function ensureCategory(
  deps: BotDeps,
  user: User,
  name: string,
  groupId: number,
): Promise<Category> {
  const existing = await deps.store.findCategoryByName(user.id, name);
  return existing ?? deps.store.createCategory(user.id, name, groupId);
}

function topCategories(deps: BotDeps, user: User): Promise<Category[]> {
  const since = new Date(deps.clock.now().getTime() - TOP_WINDOW_MS);
  return deps.store.topCategories(user.id, since, TOP_CATEGORIES);
}

function setState(deps: BotDeps, user: User, state: ChatState): Promise<void> {
  const expiresAt = new Date(deps.clock.now().getTime() + CHAT_STATE_TTL_MS);
  return deps.store.setChatState(user.id, user.telegramChatId, state, expiresAt);
}
