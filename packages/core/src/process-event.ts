import { INTL_LOCALE, t } from "./i18n";
import { formatMoney, toMinor } from "./money";
import { resolveOccurredAt } from "./occurred-at";
import type { Messenger, Store, StoredEvent, User } from "./ports";
import {
  type CompiledRule,
  classify,
  type ExtractedFields,
  UNKNOWN_MERCHANT,
} from "./rules/engine";

/** Events of the same amount and currency this close together are one purchase (ADR-0011). */
export const DEDUPE_WINDOW_MS = 30_000;

export interface ProcessDeps {
  store: Store;
  messenger: Messenger;
  rules: CompiledRule[];
}

/** Classifies a stored event and, for purchases and transfers, records and announces them. */
export async function processEvent(
  deps: ProcessDeps,
  user: User,
  event: StoredEvent,
): Promise<void> {
  const { store, messenger, rules } = deps;
  const result = classify(rules, event);

  if (result.kind === "unmatched") {
    await store.classifyEvent(event.id, { status: "unmatched" });
    return;
  }
  const ruleRef = { ruleId: result.rule.rule.id, ruleSource: result.rule.source };
  if (result.kind === "ignore") {
    await store.classifyEvent(event.id, { status: "ignored", ...ruleRef });
    return;
  }

  const { fields } = result;
  const paymentMethodId = fields.paymentMethod
    ? await store.upsertPaymentMethod(user.id, fields.paymentMethod)
    : null;
  const extraction = {
    kind: result.kind,
    merchantRaw: fields.merchant,
    merchantNormalized: fields.merchantNormalized,
    paymentMethodId,
  };
  const received = event.receivedAt.getTime();
  const inserted = await store.insertPurchase(
    {
      userId: user.id,
      occurredAt: resolveOccurredAt(event.receivedAt, fields.time, user.timezone),
      amountMinor: toMinor(fields.amount, fields.currency),
      currency: fields.currency,
      sourceEventId: event.id,
      ...extraction,
    },
    { from: new Date(received - DEDUPE_WINDOW_MS), to: new Date(received + DEDUPE_WINDOW_MS) },
  );
  const { purchase } = inserted;

  if (!inserted.created) {
    const existing = classify(rules, inserted.sourceEvent);
    const existingRichness =
      existing.kind === "unmatched" || existing.kind === "ignore" ? 0 : richness(existing.fields);
    if (richness(fields) > existingRichness) {
      await store.updatePurchaseExtraction(purchase.id, extraction);
    }
    await store.classifyEvent(event.id, {
      status: "duplicate",
      ...ruleRef,
      purchaseId: purchase.id,
    });
    return;
  }
  await store.classifyEvent(event.id, { status: result.kind, ...ruleRef, purchaseId: purchase.id });

  const intlLocale = INTL_LOCALE[user.locale];
  const time =
    fields.time ??
    new Intl.DateTimeFormat(intlLocale, {
      timeZone: user.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(event.receivedAt);
  const amount = formatMoney(purchase.amountMinor, purchase.currency, intlLocale);
  const text =
    result.kind === "transfer"
      ? t(user.locale, "transferNotice", { amount, time })
      : t(user.locale, "purchaseNotice", {
          amount,
          merchant: fields.merchant,
          paymentMethod: fields.paymentMethod ?? "",
          time,
        });

  const { messageId } = await messenger.send(user.telegramChatId, text);
  await store.setPurchaseTelegramMessage(purchase.id, messageId);
}

/** Number of optional fields the extraction found. The richer extraction wins a dedupe merge. */
function richness(fields: ExtractedFields): number {
  return [fields.merchant !== UNKNOWN_MERCHANT, fields.paymentMethod, fields.time].filter(Boolean)
    .length;
}
