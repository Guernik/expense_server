import { CURRENCIES, type Currency, fromMinor, parseAmount, toMinor } from "../money";
import { normalizeBody, normalizeMerchant, normalizeText } from "../normalize";
import type {
  ConfirmedFields,
  ExtractPurchaseOutput,
  LlmProvider,
  ProposeRuleOutput,
  StoredEvent,
} from "../ports";
import { classify, compileRules, UNKNOWN_MERCHANT } from "../rules/engine";
import { type Rule, ruleSchema } from "../rules/schema";

/** Web Crypto, on Workers and Node. Declared here because core compiles without platform types. */
declare const crypto: { randomUUID(): string };

/** Longest merchant or payment method the bot accepts from the LLM. */
const MAX_FIELD_LENGTH = 100;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The event as the classifier sees it (SPEC §4.2), so a proposed rule is written against that. */
function notification(event: StoredEvent) {
  return {
    app: normalizeText(event.app),
    title: normalizeText(event.title),
    text: normalizeBody(event.text),
  };
}

/**
 * SPEC §7.3 step 1: asks the LLM for the purchase fields of an unmatched event the user said is a
 * purchase. Null without a provider, on error or timeout, or when the output doesn't validate.
 */
export async function extractPurchase(
  llm: LlmProvider | undefined,
  event: StoredEvent,
): Promise<ConfirmedFields | null> {
  if (!llm) return null;
  try {
    return validateExtraction(await llm.extractPurchase(notification(event)));
  } catch {
    // Degrade to typed entry (ADR-0010). Providers log their own failures.
    return null;
  }
}

/** Raw LLM output to fields the user can confirm: a positive amount and a supported currency. */
export function validateExtraction(output: ExtractPurchaseOutput): ConfirmedFields | null {
  const currency = (output.currency?.trim().toUpperCase() || "ARS") as Currency;
  if (!CURRENCIES.includes(currency) || !output.amount) return null;
  let amountMinor: number;
  try {
    amountMinor = toMinor(parseAmount(output.amount.trim(), "plain"), currency);
  } catch {
    return null;
  }
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
  const time = output.time?.trim() ?? "";
  return {
    amountMinor,
    currency,
    merchant: validField(output.merchant) ?? UNKNOWN_MERCHANT,
    paymentMethod: validField(output.paymentMethod),
    time: TIME.test(time) ? time : null,
  };
}

/**
 * SPEC §7.3 step 2: asks the LLM for a `purchase` rule for this event. Null without a provider, on
 * error or timeout, or when the rule doesn't reproduce the confirmed fields: invalid proposals never
 * reach the user.
 */
export async function proposeRule(
  llm: LlmProvider | undefined,
  event: StoredEvent,
  confirmed: ConfirmedFields,
): Promise<Rule | null> {
  if (!llm) return null;
  let output: ProposeRuleOutput;
  try {
    output = await llm.proposeRule({
      ...notification(event),
      confirmed: {
        amount: fromMinor(confirmed.amountMinor, confirmed.currency),
        currency: confirmed.currency,
        merchant: confirmed.merchant,
        paymentMethod: confirmed.paymentMethod,
        time: confirmed.time,
      },
    });
  } catch {
    return null;
  }
  return validateProposedRule(output, event, confirmed);
}

/**
 * Builds the user rule from raw LLM output and keeps it only if it validates against the rule
 * schema, compiles, matches the event as a purchase, and reproduces every confirmed field.
 */
export function validateProposedRule(
  output: ProposeRuleOutput,
  event: StoredEvent,
  confirmed: ConfirmedFields,
): Rule | null {
  const parsed = ruleSchema.safeParse({
    id: `user.${crypto.randomUUID()}`,
    kind: "purchase",
    priority: 0,
    match: {
      ...(output.title && { title: output.title }),
      ...(output.text && { text: output.text }),
    },
    transform: {
      ...(output.numberFormat && { amount: { number_format: output.numberFormat } }),
      ...((output.currencyMap || output.defaultCurrency) && {
        currency: {
          ...(output.currencyMap && { map: output.currencyMap }),
          ...(output.defaultCurrency && { default: output.defaultCurrency }),
        },
      }),
      ...(output.paymentMethod && { payment_method: output.paymentMethod }),
      ...(output.merchant && { merchant: output.merchant }),
    },
    tests: [
      {
        title: event.title,
        text: event.text,
        app: event.app,
        expect: {
          amount: fromMinor(confirmed.amountMinor, confirmed.currency),
          currency: confirmed.currency,
          merchant: confirmed.merchant,
          ...(confirmed.paymentMethod && { payment_method: confirmed.paymentMethod }),
          ...(confirmed.time && { time: confirmed.time }),
        },
      },
    ],
  });
  if (!parsed.success) return null;
  const rule = parsed.data;

  try {
    const result = classify(compileRules([], [rule]), event);
    if (result.kind !== "purchase") return null;
    const { fields } = result;
    const reproduces =
      fields.currency === confirmed.currency &&
      toMinor(fields.amount, fields.currency) === confirmed.amountMinor &&
      fields.merchantNormalized === normalizeMerchant(confirmed.merchant) &&
      (confirmed.paymentMethod === null ||
        normalizeText(fields.paymentMethod ?? "") === confirmed.paymentMethod) &&
      (confirmed.time === null || fields.time === confirmed.time);
    return reproduces ? rule : null;
  } catch {
    // Extraction throws on an unparseable amount or an unmapped currency.
    return null;
  }
}

function validField(value: string | null | undefined): string | null {
  const normalized = normalizeText(value ?? "");
  return normalized && [...normalized].length <= MAX_FIELD_LENGTH ? normalized : null;
}
