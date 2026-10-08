export const CURRENCIES = ["ARS", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

const MINOR_DIGITS: Record<Currency, number> = { ARS: 2, USD: 2 };
const SYMBOL: Record<Currency, string> = { ARS: "$", USD: "US$" };

export type NumberFormat = "es-AR" | "en-US" | "plain";

/**
 * Parses a captured amount into a canonical decimal string ("15000.01", "20").
 * es-AR: "." thousands, "," decimals. en-US: "," thousands, "." decimals. plain: digits + optional ".".
 */
export function parseAmount(raw: string, format: NumberFormat): string {
  const compact = raw.replace(/\s/g, "");
  const normalized =
    format === "es-AR"
      ? compact.replace(/\./g, "").replace(",", ".")
      : format === "en-US"
        ? compact.replace(/,/g, "")
        : compact;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) throw new Error(`Unparseable amount "${raw}" (${format})`);
  const integer = (match[1] ?? "0").replace(/^0+(?=\d)/, "");
  const decimals = (match[2] ?? "").replace(/0+$/, "");
  return decimals ? `${integer}.${decimals}` : integer;
}

/** "15000.01" -> 1500001 for a 2-digit currency. */
export function toMinor(amount: string, currency: Currency): number {
  const digits = MINOR_DIGITS[currency];
  const [integer = "0", decimals = ""] = amount.split(".");
  if (decimals.length > digits) throw new Error(`Too many decimals in ${amount} for ${currency}`);
  return Number(integer) * 10 ** digits + Number(decimals.padEnd(digits, "0") || "0");
}

/** 1500001 ARS, "es-AR" -> "$15.000,01 ARS" */
export function formatMoney(amountMinor: number, currency: Currency, intlLocale: string): string {
  const digits = MINOR_DIGITS[currency];
  const number = new Intl.NumberFormat(intlLocale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amountMinor / 10 ** digits);
  return `${SYMBOL[currency]}${number} ${currency}`;
}
