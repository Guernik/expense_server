import { z } from "zod";
import { CURRENCIES, type Currency, toMinor } from "../money";
import { normalizeMerchant, normalizeText } from "../normalize";
import { localDateTimeToUtc } from "../occurred-at";
import { UNKNOWN_MERCHANT } from "../rules/engine";
import type { ImportError, RawImportRow } from "./parse";

/** One already-categorized purchase from a backfill file (SPEC §10). */
export interface ImportPurchase {
  line: number;
  occurredAt: Date;
  /** The local day of `occurredAt` as a UTC range [from, to), for the re-import check. */
  day: { from: Date; to: Date };
  amountMinor: number;
  currency: Currency;
  merchantRaw: string;
  merchantNormalized: string;
  paymentMethod: string;
  category: string;
  comment: string | null;
  /**
   * 1-based position among the file's rows with the same (date, merchant, amount, currency).
   * The row is skipped when the store already has this many imports with that key, so
   * re-importing is a no-op while genuinely repeated purchases in one file all import.
   */
  occurrence: number;
}

export interface ImportPlan {
  groups: string[];
  categories: { name: string; group: string }[];
  paymentMethods: string[];
  purchases: ImportPurchase[];
  /** Merchants whose rows all have one category. `Unknown` never gets a rule. */
  merchantRules: { merchantNormalized: string; category: string }[];
}

export interface ImportOptions {
  timezone: string;
  /** Processor prefixes stripped from merchants, as the rule packs do (SPEC §5.4). */
  stripPrefixes?: readonly string[];
}

export type PlanResult = { ok: true; plan: ImportPlan } | { ok: false; errors: ImportError[] };

const UNKNOWN_MERCHANT_NORMALIZED = normalizeMerchant(UNKNOWN_MERCHANT);

const name = z.string().transform(normalizeText).pipe(z.string().min(1, "must not be empty"));
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === null || v === "" ? undefined : v), schema.optional());

const rowSchema = z.object({
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .refine(isCalendarDate, "is not a valid date"),
  time: optional(
    z
      .string()
      .trim()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM"),
  ),
  merchant: name,
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, 'must be a positive number with "." as the decimal separator'),
  currency: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
    z.enum(CURRENCIES, `must be one of ${CURRENCIES.join(", ")}`),
  ),
  payment_method: name,
  category: name,
  group: name,
  comment: optional(z.string().transform((s) => s.trim())),
});

/**
 * Validates every row and builds what to write. Any invalid row fails the whole file, so
 * nothing is imported partially.
 */
export function planImport(rows: RawImportRow[], options: ImportOptions): PlanResult {
  const errors: ImportError[] = [];
  const groups = new Map<string, string>();
  const categories = new Map<string, { name: string; group: string; line: number }>();
  const paymentMethods = new Set<string>();
  const purchases: ImportPurchase[] = [];
  const occurrences = new Map<string, number>();
  const merchantCategories = new Map<string, Set<string>>();

  if (rows.length === 0) errors.push({ line: 1, message: "The file has no rows" });

  for (const { line, values } of rows) {
    const parsed = rowSchema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({ line, message: `${issue.path.join(".") || "row"}: ${issue.message}` });
      }
      continue;
    }
    const row = parsed.data;

    let amountMinor: number;
    try {
      amountMinor = toMinor(row.amount, row.currency);
    } catch {
      errors.push({ line, message: `amount: too many decimals for ${row.currency}` });
      continue;
    }
    if (!Number.isSafeInteger(amountMinor)) {
      errors.push({ line, message: "amount: too large" });
      continue;
    }

    const groupName = groups.get(key(row.group)) ?? row.group;
    groups.set(key(groupName), groupName);
    const category = categories.get(key(row.category));
    if (category && key(category.group) !== key(groupName)) {
      errors.push({
        line,
        message: `category: "${category.name}" is in group "${category.group}" on line ${category.line}, not "${row.group}"`,
      });
      continue;
    }
    const categoryName = category?.name ?? row.category;
    if (!category)
      categories.set(key(categoryName), { name: categoryName, group: groupName, line });
    paymentMethods.add(row.payment_method);

    const merchantNormalized = normalizeMerchant(row.merchant, options.stripPrefixes);
    const occurrenceKey = [row.date, merchantNormalized, amountMinor, row.currency].join("\u0000");
    const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
    occurrences.set(occurrenceKey, occurrence);

    const merchantSet = merchantCategories.get(merchantNormalized) ?? new Set();
    merchantSet.add(key(categoryName));
    merchantCategories.set(merchantNormalized, merchantSet);

    purchases.push({
      line,
      occurredAt: localDateTimeToUtc(row.date, row.time, options.timezone),
      day: {
        from: localDateTimeToUtc(row.date, undefined, options.timezone),
        to: localDateTimeToUtc(nextDay(row.date), undefined, options.timezone),
      },
      amountMinor,
      currency: row.currency,
      merchantRaw: row.merchant,
      merchantNormalized,
      paymentMethod: row.payment_method,
      category: categoryName,
      comment: row.comment || null,
      occurrence,
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  const merchantRules = [...merchantCategories]
    .filter(([merchant, set]) => set.size === 1 && merchant !== UNKNOWN_MERCHANT_NORMALIZED)
    .map(([merchantNormalized, set]) => ({
      merchantNormalized,
      category: required(categories.get([...set][0] ?? "")).name,
    }));

  return {
    ok: true,
    plan: {
      groups: [...groups.values()],
      categories: [...categories.values()].map(({ name, group }) => ({ name, group })),
      paymentMethods: [...paymentMethods],
      purchases,
      merchantRules,
    },
  };
}

/** Category and group names match case-insensitively, as in the store. */
function key(name: string): string {
  return name.toLowerCase();
}

function isCalendarDate(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date);
}

function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected a value");
  return value;
}
