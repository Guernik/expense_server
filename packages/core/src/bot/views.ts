import { INTL_LOCALE, type Locale, t } from "../i18n";
import { formatMoney } from "../money";
import type { Category, Group, Keyboard, StoredPurchase, User } from "../ports";
import { encodeAction } from "./callback-data";

export const TOP_CATEGORIES = 6;
export const MORE_PAGE_SIZE = 12;
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

function headerParams(user: User, purchase: StoredPurchase, category?: string) {
  const intlLocale = INTL_LOCALE[user.locale];
  const time = new Intl.DateTimeFormat(intlLocale, {
    timeZone: user.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(purchase.occurredAt);
  return {
    amount: formatMoney(purchase.amountMinor, purchase.currency, intlLocale),
    merchant: purchase.merchantRaw,
    details: [category, purchase.paymentMethod, time].filter(Boolean).join(" · "),
  };
}

export function confirmationKeyboard(locale: Locale, purchaseId: number): Keyboard {
  return [[{ text: t(locale, "change"), data: encodeAction({ type: "picker", purchaseId }) }]];
}

/** Top categories, then `More…` `➕ New category`, then `Skip`. */
export function pickerKeyboard(locale: Locale, purchaseId: number, top: Category[]): Keyboard {
  return [
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
    [{ text: t(locale, "skip"), data: encodeAction({ type: "skip", purchaseId }) }],
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
