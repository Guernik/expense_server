import { dedupeWindow } from "../dedupe";
import { t } from "../i18n";
import { normalizeMerchant, normalizeText } from "../normalize";
import { resolveOccurredAt } from "../occurred-at";
import type {
  Category,
  ChatState,
  Clock,
  ConfirmedFields,
  ExtractedBy,
  LlmProvider,
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
import { extractPurchase, proposeRule } from "./llm-extraction";
import { parseManualPurchase } from "./manual-purchase";
import { suggestCategory, suggestionLabel } from "./suggestion";
import {
  amountLabel,
  categoryLabel,
  confirmationKeyboard,
  confirmationText,
  confirmRuleKeyboard,
  excludedText,
  extractionKeyboard,
  extractionText,
  groupKeyboard,
  ignoreSimilarKeyboard,
  MAX_NAME_LENGTH,
  morePageKeyboard,
  pickerKeyboard,
  pickerText,
  ruleProposalKeyboard,
  ruleProposalText,
  TOP_CATEGORIES,
  transferKeyboard,
  transferNotExpenseText,
  transferText,
  unmatchedKeyboard,
  unmatchedText,
} from "./views";

export { MAX_NAME_LENGTH };

export interface BotDeps {
  store: Store;
  messenger: Messenger;
  clock: Clock;
  /** Absent with `LLM_PROVIDER=none`: the picker shows without a suggestion. */
  llm?: LlmProvider | undefined;
}

/** What the bot receives from the configured chat, independent of the messenger. */
export type BotInput =
  /** `replyToMessageId` is set when the user replied to one of the bot's messages. */
  | { kind: "text"; text: string; messageId: number; replyToMessageId?: number }
  | { kind: "callback"; callbackId: string; messageId: number; data: string };

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
 * merchant rule matches, otherwise the category picker, led by the LLM suggestion if there is one.
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
    const suggestion = await suggestCategory(deps, user, purchase);
    sent = await messenger.send(
      user.telegramChatId,
      pickerText(user, purchase),
      await pickerFor(deps, user, purchase.id, suggestion),
    );
  }
  await store.setPurchaseTelegramMessage(purchase.id, sent.messageId);
}

/** SPEC §7.4: asks whether a transfer is an expense. */
export async function announceTransfer(
  deps: BotDeps,
  user: User,
  purchase: StoredPurchase,
): Promise<void> {
  const { messageId } = await deps.messenger.send(
    user.telegramChatId,
    transferText(user, purchase),
    transferKeyboard(user.locale, purchase.id),
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
    return answer(await handleEventCallback(deps, user, input.messageId, action));
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
    case "suggestion": {
      const category = await suggestedCategory(deps, user, purchase);
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
        await pickerFor(deps, user, purchase.id, purchase.suggestion),
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
    case "transferExpense":
    case "transferNotExpense":
      if (purchase.kind !== "transfer" || purchase.status !== "pending") return answer();
      if (action.type === "transferExpense") {
        await setState(deps, user, {
          step: "awaiting_transfer_description",
          purchaseId: purchase.id,
        });
        await messenger.send(
          chatId,
          t(user.locale, "askTransferDescription", { amount: amountLabel(user, purchase) }),
        );
        return answer();
      }
      await store.clearChatState(chatId);
      await store.excludePurchase(purchase.id);
      await messenger.edit(chatId, input.messageId, transferNotExpenseText(user, purchase));
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

/**
 * PURCHASE / NON-PURCHASE on an unmatched event, the LLM extraction and rule proposal, and "Ignore
 * similar" (SPEC §7.3). Returns a toast for the tap, if any.
 */
async function handleEventCallback(
  deps: BotDeps,
  user: User,
  messageId: number,
  action: Extract<Action, { eventId: number }>,
): Promise<string | undefined> {
  const { store, messenger, clock } = deps;
  const { locale, telegramChatId: chatId } = user;
  const event = await store.getEvent(user.id, action.eventId);
  if (!event) return;

  if (action.type === "eventPurchase" || action.type === "eventNonPurchase") {
    if (event.status !== "unmatched") return;
    if (action.type === "eventPurchase") {
      const extraction = await extractPurchase(deps.llm, event);
      await setState(deps, user, {
        step: "awaiting_manual_extraction",
        eventId: event.id,
        messageId,
        ...(extraction && { extraction }),
      });
      if (extraction) {
        await messenger.send(
          chatId,
          extractionText(user, extraction),
          extractionKeyboard(locale, event.id),
        );
      } else {
        await messenger.send(chatId, t(locale, "askManualPurchase"));
      }
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

  if (action.type === "extractionCorrect" || action.type === "extractionEdit") {
    const state = await store.getChatState(chatId, clock.now());
    if (
      event.status !== "unmatched" ||
      state?.step !== "awaiting_manual_extraction" ||
      state.eventId !== event.id ||
      !state.extraction
    ) {
      return t(locale, "expired");
    }
    await messenger.edit(chatId, messageId, extractionText(user, state.extraction));
    if (action.type === "extractionCorrect") {
      await recordConfirmedPurchase(deps, user, event, state.messageId, state.extraction, "llm");
      return;
    }
    await setState(deps, user, {
      step: "awaiting_manual_extraction",
      eventId: event.id,
      messageId: state.messageId,
    });
    await messenger.send(chatId, t(locale, "askManualPurchase"));
    return;
  }

  if (action.type === "saveRule" || action.type === "rejectRule") {
    const proposed = await store.findProposedRule(user.id, event.id);
    if (!proposed) return;
    const text = ruleProposalText(locale, proposed.rule);
    if (action.type === "saveRule") {
      await store.enableUserRule(proposed.id);
      await messenger.edit(chatId, messageId, `${text}\n\n${t(locale, "ruleSaved")}`);
    } else {
      await store.deleteUserRule(proposed.id);
      await messenger.edit(chatId, messageId, `${text}\n\n${t(locale, "ruleRejected")}`);
    }
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

/** `<amount> <merchant>` typed after PURCHASE, or after `✏️ Edit` on the LLM extraction. */
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

  await recordConfirmedPurchase(
    deps,
    user,
    event,
    state.messageId,
    { ...parsed, paymentMethod: null, time: null },
    "user",
  );
}

/**
 * The user confirmed the fields of an unmatched event (SPEC §7.3): offers the LLM's rule proposal
 * if it validates, then dedupe and the normal category flow.
 */
async function recordConfirmedPurchase(
  deps: BotDeps,
  user: User,
  event: StoredEvent,
  noticeMessageId: number,
  fields: ConfirmedFields,
  extractedBy: ExtractedBy,
): Promise<void> {
  const { store, messenger } = deps;
  const chatId = user.telegramChatId;
  await store.clearChatState(chatId);
  await messenger.edit(chatId, noticeMessageId, answeredText(user, event, "eventPurchase"));

  const rule = await proposeRule(deps.llm, event, fields);
  if (rule) {
    // Disabled until `Save rule`: classification never uses it before the user confirms.
    await store.insertUserRule(user.id, rule, event.id, { enabled: false });
    await messenger.send(
      chatId,
      ruleProposalText(user.locale, rule),
      ruleProposalKeyboard(user.locale, event.id),
    );
  }

  const paymentMethodId = fields.paymentMethod
    ? await store.upsertPaymentMethod(user.id, fields.paymentMethod)
    : null;
  const inserted = await store.insertPurchase(
    {
      userId: user.id,
      kind: "purchase",
      occurredAt: resolveOccurredAt(event.receivedAt, fields.time ?? undefined, user.timezone),
      amountMinor: fields.amountMinor,
      currency: fields.currency,
      merchantRaw: fields.merchant,
      merchantNormalized: normalizeMerchant(fields.merchant),
      paymentMethodId,
      sourceEventId: event.id,
    },
    dedupeWindow(event.receivedAt),
  );
  const { purchase } = inserted;
  await store.classifyEvent(event.id, {
    status: inserted.created ? "purchase" : "duplicate",
    purchaseId: purchase.id,
    extractedBy,
  });
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

  if (state.step === "awaiting_transfer_description") {
    await store.clearChatState(chatId);
    if (purchase.kind !== "transfer" || purchase.status !== "pending") return;
    await describeTransfer(deps, user, purchase, name);
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
      await pickerFor(deps, user, purchase.id, purchase.suggestion),
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
 * The transfer description becomes its merchant, then the transfer message turns into the category
 * picker. Transfers never create merchant rules (`canHaveMerchantRule`).
 */
async function describeTransfer(
  deps: BotDeps,
  user: User,
  transfer: StoredPurchase,
  description: string,
): Promise<void> {
  const { store, messenger } = deps;
  const described: StoredPurchase = {
    ...transfer,
    merchantRaw: description,
    merchantNormalized: normalizeMerchant(description),
  };
  await store.updatePurchaseExtraction(transfer.id, {
    kind: described.kind,
    merchantRaw: described.merchantRaw,
    merchantNormalized: described.merchantNormalized,
    paymentMethodId: described.paymentMethodId,
  });
  const text = pickerText(user, described);
  const keyboard = await pickerFor(deps, user, described.id, described.suggestion);
  if (described.telegramMessageId !== null) {
    await messenger.edit(user.telegramChatId, described.telegramMessageId, text, keyboard);
  } else {
    const { messageId } = await messenger.send(user.telegramChatId, text, keyboard);
    await store.setPurchaseTelegramMessage(described.id, messageId);
  }
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

/** The stored suggestion as a category, creating the suggested category and group if new. */
async function suggestedCategory(
  deps: BotDeps,
  user: User,
  purchase: StoredPurchase,
): Promise<Category | null> {
  const { suggestion } = purchase;
  if (!suggestion) return null;
  if ("categoryId" in suggestion) return deps.store.getCategory(user.id, suggestion.categoryId);
  const group = await deps.store.ensureGroup(user.id, suggestion.groupName);
  return ensureCategory(deps, user, suggestion.categoryName, group.id);
}

async function pickerFor(
  deps: BotDeps,
  user: User,
  purchaseId: number,
  suggestion: StoredPurchase["suggestion"],
) {
  const since = new Date(deps.clock.now().getTime() - TOP_WINDOW_MS);
  const [top, label] = await Promise.all([
    deps.store.topCategories(user.id, since, TOP_CATEGORIES),
    suggestionLabel(deps.store, user, suggestion),
  ]);
  return pickerKeyboard(user.locale, purchaseId, top, label);
}

function setState(deps: BotDeps, user: User, state: ChatState): Promise<void> {
  const expiresAt = new Date(deps.clock.now().getTime() + CHAT_STATE_TTL_MS);
  return deps.store.setChatState(user.id, user.telegramChatId, state, expiresAt);
}
