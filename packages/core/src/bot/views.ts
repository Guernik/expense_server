import { INTL_LOCALE, type Locale, t } from "../i18n";
import { formatMoney } from "../money";
import { normalizeBody, normalizeText } from "../normalize";
import type {
  Category,
  ConfirmedFields,
  Group,
  Keyboard,
  StoredEvent,
  StoredPurchase,
  User,
} from "../ports";
import type { Rule } from "../rules/schema";
import { encodeAction } from "./callback-data";

export const TOP_CATEGORIES = 6;
export const MORE_PAGE_SIZE = 12;
/** Longest category or group name the bot accepts. */
export const MAX_NAME_LENGTH = 40;
const BUTTONS_PER_ROW = 3;

export function categoryLabel(category: Category): string {
  return `${category.name} (${category.group.name})`;
}

/** SPEC §7.2b header: `🛒 amount · merchant` / `payment method · time`. */
export function pickerText(user: User, purchase: StoredPurchase): string {
  return t(user.locale, "purchaseNotice", headerParams(user, purchase));
}

/** SPEC §7.2a: `✅ amount · merchant` / `category (group) · payment method · time`. */
export function confirmationText(user: User, purchase: StoredPurchase, category: Category): string {
  return t(
    user.locale,
    "purchaseCategorized",
    headerParams(user, purchase, categoryLabel(category)),
  );
}

/** SPEC §7.2b after `🚫 Not a purchase`: the picker header marked 🚫. */
export function excludedText(user: User, purchase: StoredPurchase): string {
  return t(user.locale, "purchaseExcluded", headerParams(user, purchase));
}

/** SPEC §7.4: `↗️ Transfer amount` / time. */
export function transferText(user: User, purchase: StoredPurchase): string {
  const { amount, time } = headerParams(user, purchase);
  return t(user.locale, "transferNotice", { amount, time });
}

/** SPEC §7.4 after `↔️ Not an expense`: the transfer notice followed by the answer. */
export function transferNotExpenseText(user: User, purchase: StoredPurchase): string {
  return `${transferText(user, purchase)}\n\n${t(user.locale, "transferNotExpense")}`;
}

export function transferKeyboard(locale: Locale, purchaseId: number): Keyboard {
  return [
    [
      {
        text: t(locale, "transferExpense"),
        data: encodeAction({ type: "transferExpense", purchaseId }),
      },
      {
        text: t(locale, "transferNotExpense"),
        data: encodeAction({ type: "transferNotExpense", purchaseId }),
      },
    ],
  ];
}

/** SPEC §7.3: `❓ Unrecognized notification (app)` / "title" / "text". */
export function unmatchedText(user: User, event: StoredEvent): string {
  const app = normalizeText(event.app);
  return t(user.locale, "unmatchedNotice", {
    app: app ? ` (${app})` : "",
    title: normalizeText(event.title),
    text: normalizeBody(event.text),
  });
}

export function unmatchedKeyboard(locale: Locale, eventId: number): Keyboard {
  return [
    [
      { text: t(locale, "eventPurchase"), data: encodeAction({ type: "eventPurchase", eventId }) },
      {
        text: t(locale, "eventNonPurchase"),
        data: encodeAction({ type: "eventNonPurchase", eventId }),
      },
    ],
  ];
}

export function ignoreSimilarKeyboard(locale: Locale, eventId: number): Keyboard {
  return [
    [{ text: t(locale, "ignoreSimilar"), data: encodeAction({ type: "ignoreSimilar", eventId }) }],
  ];
}

export function confirmRuleKeyboard(locale: Locale, eventId: number): Keyboard {
  return [
    [
      { text: t(locale, "confirm"), data: encodeAction({ type: "confirmRule", eventId }) },
      { text: t(locale, "cancel"), data: encodeAction({ type: "cancelRule", eventId }) },
    ],
  ];
}

/** SPEC §7.3 step 1: the LLM extraction, for `✅ Correct` / `✏️ Edit`. */
export function extractionText(user: User, fields: ConfirmedFields): string {
  const details = [fields.paymentMethod, fields.time].filter(Boolean).join(" · ");
  return t(user.locale, "extractionNotice", {
    amount: formatMoney(fields.amountMinor, fields.currency, INTL_LOCALE[user.locale]),
    merchant: fields.merchant,
    details: details ? `\n${details}` : "",
  });
}

export function extractionKeyboard(locale: Locale, eventId: number): Keyboard {
  return [
    [
      {
        text: t(locale, "extractionCorrect"),
        data: encodeAction({ type: "extractionCorrect", eventId }),
      },
      {
        text: t(locale, "extractionEdit"),
        data: encodeAction({ type: "extractionEdit", eventId }),
      },
    ],
  ];
}

/** SPEC §7.3 step 2: the proposed rule's patterns, one `field: pattern` line each. */
export function ruleProposalText(locale: Locale, rule: Rule): string {
  const patterns = [
    rule.match.title && `${t(locale, "fieldTitle")}: ${rule.match.title}`,
    rule.match.text && `${t(locale, "fieldText")}: ${rule.match.text}`,
  ].filter(Boolean);
  return t(locale, "ruleProposal", { patterns: patterns.join("\n") });
}

export function ruleProposalKeyboard(locale: Locale, eventId: number): Keyboard {
  return [
    [
      { text: t(locale, "saveRule"), data: encodeAction({ type: "saveRule", eventId }) },
      { text: t(locale, "rejectRule"), data: encodeAction({ type: "rejectRule", eventId }) },
    ],
  ];
}

export function amountLabel(user: User, purchase: StoredPurchase): string {
  return formatMoney(purchase.amountMinor, purchase.currency, INTL_LOCALE[user.locale]);
}

function headerParams(user: User, purchase: StoredPurchase, category?: string) {
  const intlLocale = INTL_LOCALE[user.locale];
  const time = new Intl.DateTimeFormat(intlLocale, {
    timeZone: user.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(purchase.occurredAt);
  return {
    amount: amountLabel(user, purchase),
    time,
    merchant: purchase.merchantRaw,
    details: [category, purchase.paymentMethod, time].filter(Boolean).join(" · "),
  };
}

export function confirmationKeyboard(locale: Locale, purchaseId: number): Keyboard {
  return [[{ text: t(locale, "change"), data: encodeAction({ type: "picker", purchaseId }) }]];
}

/**
 * The LLM suggestion if any, then top categories, then `More…` `➕ New category`, then
 * `🚫 Not a purchase` `Skip`.
 */
export function pickerKeyboard(
  locale: Locale,
  purchaseId: number,
  top: Category[],
  suggestion: { category: string; group: string } | null = null,
): Keyboard {
  return [
    ...(suggestion
      ? [
          [
            {
              text: t(locale, "suggestion", suggestion),
              data: encodeAction({ type: "suggestion", purchaseId }),
            },
          ],
        ]
      : []),
    ...chunk(
      top.map((c) => ({
        text: c.name,
        data: encodeAction({ type: "pick", purchaseId, categoryId: c.id }),
      })),
    ),
    [
      { text: t(locale, "more"), data: encodeAction({ type: "more", purchaseId, page: 0 }) },
      { text: t(locale, "newCategory"), data: encodeAction({ type: "newCategory", purchaseId }) },
    ],
    [
      { text: t(locale, "notPurchase"), data: encodeAction({ type: "notPurchase", purchaseId }) },
      { text: t(locale, "skip"), data: encodeAction({ type: "skip", purchaseId }) },
    ],
  ];
}

/**
 * One page of all categories, grouped: a non-interactive header per group, then its categories.
 * `categories` must be ordered by group.
 */
export function morePageKeyboard(
  locale: Locale,
  purchaseId: number,
  categories: Category[],
  page: number,
): Keyboard {
  const pages = Math.max(1, Math.ceil(categories.length / MORE_PAGE_SIZE));
  const current = Math.min(Math.max(page, 0), pages - 1);
  const slice = categories.slice(current * MORE_PAGE_SIZE, (current + 1) * MORE_PAGE_SIZE);

  const rows: Keyboard = [];
  for (const group of groupBy(slice)) {
    rows.push([{ text: `— ${group.name} —`, data: encodeAction({ type: "noop" }) }]);
    rows.push(
      ...chunk(
        group.categories.map((c) => ({
          text: c.name,
          data: encodeAction({ type: "pick", purchaseId, categoryId: c.id }),
        })),
      ),
    );
  }

  const nav = [];
  if (current > 0) {
    nav.push({
      text: t(locale, "previous"),
      data: encodeAction({ type: "more", purchaseId, page: current - 1 }),
    });
  }
  nav.push({ text: t(locale, "back"), data: encodeAction({ type: "picker", purchaseId }) });
  if (current < pages - 1) {
    nav.push({
      text: t(locale, "next"),
      data: encodeAction({ type: "more", purchaseId, page: current + 1 }),
    });
  }
  rows.push(nav);
  rows.push([
    { text: t(locale, "newCategory"), data: encodeAction({ type: "newCategory", purchaseId }) },
  ]);
  return rows;
}

/** Existing groups plus `➕ New group`, shown after the user names a new category. */
export function groupKeyboard(locale: Locale, purchaseId: number, groups: Group[]): Keyboard {
  return [
    ...chunk(
      groups.map((g) => ({
        text: g.name,
        data: encodeAction({ type: "group", purchaseId, groupId: g.id }),
      })),
    ),
    [{ text: t(locale, "newGroup"), data: encodeAction({ type: "newGroup", purchaseId }) }],
  ];
}

function groupBy(categories: Category[]): { name: string; categories: Category[] }[] {
  const groups: { id: number; name: string; categories: Category[] }[] = [];
  for (const category of categories) {
    const last = groups.at(-1);
    if (last?.id === category.group.id) last.categories.push(category);
    else groups.push({ ...category.group, categories: [category] });
  }
  return groups;
}

function chunk<T>(items: T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += BUTTONS_PER_ROW) {
    rows.push(items.slice(i, i + BUTTONS_PER_ROW));
  }
  return rows;
}
