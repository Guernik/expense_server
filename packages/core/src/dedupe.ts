/** Events of the same amount and currency this close together are one purchase (ADR-0011). */
export const DEDUPE_WINDOW_MS = 10_000;

/** The `received_at` range whose purchases a new event is merged into. */
export function dedupeWindow(receivedAt: Date): { from: Date; to: Date } {
  const received = receivedAt.getTime();
  return { from: new Date(received - DEDUPE_WINDOW_MS), to: new Date(received + DEDUPE_WINDOW_MS) };
}
