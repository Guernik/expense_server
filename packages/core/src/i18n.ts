export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];

/** Locale used for Intl number/date formatting. */
export const INTL_LOCALE: Record<Locale, string> = { en: "en-US", es: "es-AR" };

const en = {
  purchaseNotice: "🛒 {amount} · {merchant}\n{details}",
  purchaseCategorized: "✅ {amount} · {merchant}\n{details}",
  transferNotice: "↗️ Transfer {amount}\n{time}",
  transferExpense: "💸 Expense",
  transferNotExpense: "↔️ Not an expense",
  askTransferDescription: "What was the transfer of {amount} for? Type a short description.",
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
  purchaseExcluded: "🚫 {amount} · {merchant}\n{details}",
  notPurchase: "🚫 Not a purchase",
  unmatchedNotice: '❓ Unrecognized notification{app}\n"{title}"\n"{text}"',
  eventPurchase: "💳 PURCHASE",
  eventNonPurchase: "🚫 NON-PURCHASE",
  askManualPurchase:
    "Type the amount and merchant, e.g. 15000.50 Axion. Add USD if it was in dollars.",
  manualPurchaseInvalid: "Couldn't read that. Type the amount and merchant, e.g. 15000.50 Axion.",
  ignoreSimilar: "🔇 Ignore similar",
  confirmIgnoreRule: "Ignore notifications whose {field} matches this?\n{pattern}",
  fieldTitle: "title",
  fieldText: "text",
  confirm: "Confirm",
  cancel: "Cancel",
  ignoreRuleSaved: "🔇 Similar notifications will be ignored.",
  help: "Commands:\n/pending - re-send the prompts of pending purchases and transfers\n/setgroup <category> <group> - move a category to a group\n/help - this list\n\nReply to a purchase message to set its comment.",
  nothingPending: "Nothing pending.",
  setGroupUsage: "Usage: /setgroup <category> <group>, e.g. /setgroup Delivery Food",
  unknownCategory: "There is no category named {name}.",
  categoryMoved: "{category} is now in {group}.",
};

const es: typeof en = {
  purchaseNotice: "🛒 {amount} · {merchant}\n{details}",
  purchaseCategorized: "✅ {amount} · {merchant}\n{details}",
  transferNotice: "↗️ Transferencia {amount}\n{time}",
  transferExpense: "💸 Gasto",
  transferNotExpense: "↔️ No es un gasto",
  askTransferDescription:
    "¿En qué fue la transferencia de {amount}? Escribí una descripción corta.",
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
  purchaseExcluded: "🚫 {amount} · {merchant}\n{details}",
  notPurchase: "🚫 No es una compra",
  unmatchedNotice: '❓ Notificación no reconocida{app}\n"{title}"\n"{text}"',
  eventPurchase: "💳 COMPRA",
  eventNonPurchase: "🚫 NO ES COMPRA",
  askManualPurchase:
    "Escribí el monto y el comercio, por ejemplo 15000,50 Axion. Agregá USD si fue en dólares.",
  manualPurchaseInvalid:
    "No lo entendí. Escribí el monto y el comercio, por ejemplo 15000,50 Axion.",
  ignoreSimilar: "🔇 Ignorar similares",
  confirmIgnoreRule: "¿Ignorar las notificaciones cuyo {field} coincida con esto?\n{pattern}",
  fieldTitle: "título",
  fieldText: "texto",
  confirm: "Confirmar",
  cancel: "Cancelar",
  ignoreRuleSaved: "🔇 Las notificaciones similares se van a ignorar.",
  help: "Comandos:\n/pending - reenvía las preguntas de compras y transferencias pendientes\n/setgroup <categoría> <grupo> - mueve una categoría a un grupo\n/help - esta lista\n\nRespondé a un mensaje de una compra para guardar un comentario.",
  nothingPending: "No hay nada pendiente.",
  setGroupUsage: "Uso: /setgroup <categoría> <grupo>, por ejemplo /setgroup Delivery Comida",
  unknownCategory: "No hay ninguna categoría llamada {name}.",
  categoryMoved: "{category} ahora está en {group}.",
};

const MESSAGES: Record<Locale, typeof en> = { en, es };

export type MessageKey = keyof typeof en;

export function t(locale: Locale, key: MessageKey, params: Record<string, string> = {}): string {
  return MESSAGES[locale][key].replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? "");
}
