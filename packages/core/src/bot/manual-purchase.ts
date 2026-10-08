import type { Locale } from "../i18n";
import { type Currency, type NumberFormat, parseAmount, toMinor } from "../money";
import { normalizeText } from "../normalize";

export interface ManualPurchase {
  amountMinor: number;
  currency: Currency;
  merchant: string;
}

const NUMBER_FORMAT: Record<Locale, NumberFormat> = { en: "en-US", es: "es-AR" };

const MANUAL_PURCHASE =
  /^(?:(?<before>USD|ARS)\s*)?\$?\s*(?<amount>\d[\d.,]*)\s+(?:(?<after>USD|ARS)\s+)?(?<merchant>.+)$/iu;

/**
 * Parses `<amount> <merchant>` typed after PURCHASE (SPEC §7.3), e.g. `15000,50 Axion`. The amount
 * uses the locale's number format. Currency is ARS unless `USD` is typed next to the amount.
 */
export function parseManualPurchase(input: string, locale: Locale): ManualPurchase | null {
  const groups = MANUAL_PURCHASE.exec(normalizeText(input))?.groups;
  if (!groups?.amount || !groups.merchant) return null;
  const currency = (groups.before ?? groups.after ?? "ARS").toUpperCase() as Currency;
  try {
    const amountMinor = toMinor(parseAmount(groups.amount, NUMBER_FORMAT[locale]), currency);
    if (amountMinor <= 0) return null;
    return { amountMinor, currency, merchant: groups.merchant };
  } catch {
    return null;
  }
}
