import { describe, expect, it } from "vitest";
import { type Action, decodeAction, encodeAction, MAX_CALLBACK_BYTES } from "./callback-data";

const MAX_ID = Number.MAX_SAFE_INTEGER;

const ACTIONS: Action[] = [
  { type: "pick", purchaseId: MAX_ID, categoryId: MAX_ID },
  { type: "suggestion", purchaseId: MAX_ID },
  { type: "more", purchaseId: MAX_ID, page: 999 },
  { type: "picker", purchaseId: MAX_ID },
  { type: "newCategory", purchaseId: MAX_ID },
  { type: "group", purchaseId: MAX_ID, groupId: MAX_ID },
  { type: "newGroup", purchaseId: MAX_ID },
  { type: "skip", purchaseId: MAX_ID },
  { type: "notPurchase", purchaseId: MAX_ID },
  { type: "transferExpense", purchaseId: MAX_ID },
  { type: "transferNotExpense", purchaseId: MAX_ID },
  { type: "eventPurchase", eventId: MAX_ID },
  { type: "eventNonPurchase", eventId: MAX_ID },
  { type: "ignoreSimilar", eventId: MAX_ID },
  { type: "confirmRule", eventId: MAX_ID },
  { type: "cancelRule", eventId: MAX_ID },
  { type: "extractionCorrect", eventId: MAX_ID },
  { type: "extractionEdit", eventId: MAX_ID },
  { type: "saveRule", eventId: MAX_ID },
  { type: "rejectRule", eventId: MAX_ID },
  { type: "noop" },
];

describe("callback data", () => {
  it.each(ACTIONS)("round-trips $type under 64 bytes", (action) => {
    const data = encodeAction(action);
    // ASCII only, so length in bytes equals length in characters.
    expect(data).toMatch(/^[\x20-\x7e]+$/);
    expect(data.length).toBeLessThan(MAX_CALLBACK_BYTES);
    expect(decodeAction(data)).toEqual(action);
  });

  it.each(["", "x", "c:1", "p:1:2", "q:1", "x:1:2", "c:a:1", "c:1:2:3"])("rejects %j", (data) => {
    expect(decodeAction(data)).toBeNull();
  });
});
