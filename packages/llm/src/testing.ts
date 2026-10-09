import type { SuggestCategoryInput } from "@denarii/core";
import { vi } from "vitest";

/** Test helpers shared by the provider tests. Not exported from the package. */

const food = { id: 1, name: "Food" };
export const SUGGEST_INPUT: SuggestCategoryInput = {
  merchant: "SHOWCASE CORDOBA",
  amountMinor: 1020000,
  currency: "ARS",
  paymentMethod: "Mercado Pago cuenta",
  categories: [{ id: 10, name: "Delivery", group: food }],
  groups: [food, { id: 2, name: "Leisure" }],
  examples: [
    {
      merchant: "PEDIDOSYA",
      amountMinor: 1500000,
      currency: "ARS",
      paymentMethod: null,
      category: { id: 10, name: "Delivery", group: food },
    },
  ],
};

export const NOTIFICATION = {
  app: "Naranja X",
  title: "Compraste con tu tarjeta",
  text: "Pagaste $ 4.250,50 en FARMACIA CENTRAL con Visa 1234 a las 14:05",
};

export interface RecordedRequest {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

/**
 * A fake `fetch` that records requests. `respond` returning `"hang"` never answers until the
 * request is aborted. No network.
 */
export function fakeFetch(respond: () => Response | "hang") {
  const requests: RecordedRequest[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    const response = respond();
    if (response !== "hang") return response;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, requests };
}
