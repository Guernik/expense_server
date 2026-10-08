export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];

/** Locale used for Intl number/date formatting. */
export const INTL_LOCALE: Record<Locale, string> = { en: "en-US", es: "es-AR" };

const en = {
  purchaseNotice: "🛒 {amount} · {merchant}\n{paymentMethod} · {time}",
  transferNotice: "↗️ Transfer {amount}\n{time}",
  start: "denarii is running. Your purchases will show up here.",
};

const es: typeof en = {
  purchaseNotice: "🛒 {amount} · {merchant}\n{paymentMethod} · {time}",
  transferNotice: "↗️ Transferencia {amount}\n{time}",
  start: "denarii está funcionando. Tus compras van a aparecer acá.",
};

const MESSAGES: Record<Locale, typeof en> = { en, es };

export type MessageKey = keyof typeof en;

export function t(locale: Locale, key: MessageKey, params: Record<string, string> = {}): string {
  return MESSAGES[locale][key].replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? "");
}
