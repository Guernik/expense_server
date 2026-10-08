export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];

/** Locale used for Intl number/date formatting. */
export const INTL_LOCALE: Record<Locale, string> = { en: "en-US", es: "es-AR" };

const en = {
  purchaseNotice: "🛒 {amount} · {merchant}\n{details}",
  purchaseCategorized: "✅ {amount} · {merchant}\n{details}",
  transferNotice: "↗️ Transfer {amount}\n{time}",
  start: "denarii is running. Your purchases will show up here.",
  more: "More…",
  newCategory: "➕ New category",
  newGroup: "➕ New group",
  skip: "Skip",
  change: "Change",
  back: "« Back",
  previous: "‹",
  next: "›",
  skipped: "Skipped. It stays pending.",
  askCategoryName: "Name of the new category for {merchant}?",
  askGroup: "Which group does {category} belong to? Tap one or type a new name.",
  askGroupName: "Name of the new group for {category}?",
  nameTooLong: "Too long. Use at most {max} characters.",
  expired: "This expired. Open the picker again.",
};

const es: typeof en = {
  purchaseNotice: "🛒 {amount} · {merchant}\n{details}",
  purchaseCategorized: "✅ {amount} · {merchant}\n{details}",
  transferNotice: "↗️ Transferencia {amount}\n{time}",
  start: "denarii está funcionando. Tus compras van a aparecer acá.",
  more: "Más…",
  newCategory: "➕ Nueva categoría",
  newGroup: "➕ Nuevo grupo",
  skip: "Omitir",
  change: "Cambiar",
  back: "« Volver",
  previous: "‹",
  next: "›",
  skipped: "Omitida. Queda pendiente.",
  askCategoryName: "¿Nombre de la nueva categoría para {merchant}?",
  askGroup: "¿A qué grupo pertenece {category}? Tocá uno o escribí un nombre nuevo.",
  askGroupName: "¿Nombre del nuevo grupo para {category}?",
  nameTooLong: "Demasiado largo. Usá como máximo {max} caracteres.",
  expired: "Esto expiró. Abrí el selector de nuevo.",
};

const MESSAGES: Record<Locale, typeof en> = { en, es };

export type MessageKey = keyof typeof en;

export function t(locale: Locale, key: MessageKey, params: Record<string, string> = {}): string {
  return MESSAGES[locale][key].replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? "");
}
