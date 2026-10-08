import { t } from "../i18n";
import { normalizeMerchant, normalizeText } from "../normalize";
import type { Category, ChatState, Clock, Messenger, Store, StoredPurchase, User } from "../ports";
import { UNKNOWN_MERCHANT } from "../rules/engine";
import { decodeAction } from "./callback-data";
import {
  categoryLabel,
  confirmationKeyboard,
  confirmationText,
  groupKeyboard,
  morePageKeyboard,
  pickerKeyboard,
  pickerText,
  TOP_CATEGORIES,
} from "./views";

export interface BotDeps {
  store: Store;
  messenger: Messenger;
  clock: Clock;
}

/** What the bot receives from the configured chat, independent of the messenger. */
export type BotInput =
  | { kind: "text"; text: string }
  | { kind: "callback"; callbackId: string; messageId: number; data: string };

export const MAX_NAME_LENGTH = 40;
const UNKNOWN_MERCHANT_NORMALIZED = normalizeMerchant(UNKNOWN_MERCHANT);
const CHAT_STATE_TTL_MS = 15 * 60_000;
const TOP_WINDOW_MS = 90 * 24 * 60 * 60_000;

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

export async function handleBotInput(deps: BotDeps, user: User, input: BotInput): Promise<void> {
  if (input.kind === "callback") await handleCallback(deps, user, input);
  else await handleText(deps, user, input.text);
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

async function handleText(deps: BotDeps, user: User, text: string): Promise<void> {
  const { store, messenger, clock } = deps;
  const chatId = user.telegramChatId;
  if (text.startsWith("/start")) {
    await messenger.send(chatId, t(user.locale, "start"));
    return;
  }

  const state = await store.getChatState(chatId, clock.now());
  const name = normalizeText(text);
  if (!state || !name || name.startsWith("/")) return;
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
