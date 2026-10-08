import {
  DEDUPE_WINDOW_MS,
  type LlmProvider,
  type SuggestCategoryInput,
  type SuggestCategoryOutput,
} from "@denarii/core";
import { schema } from "@denarii/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { GALICIA_PURCHASE, setup } from "./test-harness";

type Harness = ReturnType<typeof setup>;

/** A fake provider: records its inputs and answers with `answer` (or rejects with it). */
function fakeLlm(answer: SuggestCategoryOutput | Error) {
  const calls: SuggestCategoryInput[] = [];
  const llm: LlmProvider = {
    async suggestCategory(input) {
      calls.push(input);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { llm, calls };
}

async function ingestPurchase(h: Harness, merchant = "SHOWCASE CORDOBA") {
  await h.ingest({
    ...GALICIA_PURCHASE,
    title: "Pagaste $10.200",
    text: `A ${merchant} con tu Visa Crédito 3551 a las 22:32`,
  });
  await h.settled();
  h.clock.current = new Date(h.clock.current.getTime() + DEDUPE_WINDOW_MS + 1000);
  return h.messages.at(-1);
}

async function seed(h: Harness) {
  const { store } = h.runtime;
  const user = await store.ensureUser({ telegramChatId: "42", locale: "es", timezone: "UTC" });
  const leisure = await store.ensureGroup(user.id, "Leisure");
  const food = await store.ensureGroup(user.id, "Food");
  const cinema = await store.createCategory(user.id, "Cinema", leisure.id);
  const delivery = await store.createCategory(user.id, "Delivery", food.id);
  return { user, leisure, food, cinema, delivery };
}

function purchases(h: Harness) {
  return h.db.select().from(schema.purchases).all();
}

function merchantRules(h: Harness) {
  return h.db
    .select({
      merchant: schema.merchantRules.merchantNormalized,
      category: schema.categories.name,
      group: schema.groups.name,
    })
    .from(schema.merchantRules)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.merchantRules.categoryId))
    .innerJoin(schema.groups, eq(schema.groups.id, schema.categories.groupId))
    .all();
}

describe("LLM category suggestion", () => {
  it("shows an existing-category suggestion as the picker's first row and stores it", async () => {
    const h = setup("es");
    const { cinema } = await seed(h);
    h.runtime.llm = fakeLlm({ categoryId: cinema.id }).llm;

    const picker = await ingestPurchase(h);

    expect(h.buttons(picker)?.[0]).toEqual(["✨ Cinema (Leisure)"]);
    expect(purchases(h)[0]).toMatchObject({
      status: "pending",
      categoryId: null,
      suggestedCategoryId: cinema.id,
    });
  });

  it("sends the merchant, amount, payment method, taxonomy and examples", async () => {
    const fake = fakeLlm({ newCategoryName: "Cinema", newGroupName: "Leisure" });
    const h = setup("es", fake);
    await seed(h);

    // A purchase the user categorizes by hand becomes an example for the next one.
    const first = await ingestPurchase(h, "PEDIDOSYA");
    await h.tap(first, "Delivery");
    await ingestPurchase(h);

    expect(fake.calls).toHaveLength(2);
    const input = fake.calls[1];
    expect(input).toMatchObject({
      merchant: "SHOWCASE CORDOBA",
      amountMinor: 1020000,
      currency: "ARS",
      paymentMethod: "Galicia Visa Crédito 3551",
    });
    expect(input?.categories.map((c) => `${c.name} (${c.group.name})`)).toEqual([
      "Delivery (Food)",
      "Cinema (Leisure)",
    ]);
    expect(input?.groups.map((g) => g.name)).toEqual(["Food", "Leisure"]);
    expect(input?.examples).toEqual([
      expect.objectContaining({
        merchant: "PEDIDOSYA",
        category: expect.objectContaining({ name: "Delivery" }),
      }),
    ]);
  });

  it("tapping an existing-category suggestion categorizes and creates the merchant rule", async () => {
    const h = setup("es");
    const { cinema } = await seed(h);
    h.runtime.llm = fakeLlm({ categoryId: cinema.id }).llm;

    const picker = await ingestPurchase(h);
    await h.tap(picker, "✨ Cinema (Leisure)");

    expect(purchases(h)[0]).toMatchObject({
      status: "categorized",
      categoryId: cinema.id,
      categorizedBy: "user",
    });
    expect(merchantRules(h)).toEqual([
      { merchant: "SHOWCASE CORDOBA", category: "Cinema", group: "Leisure" },
    ]);
    expect(h.message(picker?.messageId)?.text).toContain("Cinema (Leisure)");
    expect(h.buttons(picker)).toEqual([["Cambiar"]]);
  });

  it("tapping a new-category suggestion creates the category and group", async () => {
    const fake = fakeLlm({ newCategoryName: "Theatre", newGroupName: "Culture" });
    const h = setup("es", fake);
    await seed(h);

    const picker = await ingestPurchase(h, "TEATRO DEL LIBERTADOR");
    expect(h.buttons(picker)?.[0]).toEqual(["✨ Theatre (Culture)"]);
    expect(purchases(h)[0]).toMatchObject({
      suggestedCategoryId: null,
      suggestedCategoryName: "Theatre",
      suggestedGroupName: "Culture",
    });
    // Nothing is created until the user taps.
    expect(h.db.select().from(schema.categories).all()).toHaveLength(2);

    await h.tap(picker, "✨ Theatre (Culture)");

    expect(merchantRules(h)).toEqual([
      { merchant: "TEATRO DEL LIBERTADOR", category: "Theatre", group: "Culture" },
    ]);
    expect(purchases(h)[0]?.status).toBe("categorized");
  });

  it("a new category can go into an existing group", async () => {
    const h = setup("es");
    const { leisure } = await seed(h);
    h.runtime.llm = fakeLlm({ newCategoryName: "Theatre", groupId: leisure.id }).llm;

    const picker = await ingestPurchase(h);
    await h.tap(picker, "✨ Theatre (Leisure)");

    expect(merchantRules(h)).toEqual([
      { merchant: "SHOWCASE CORDOBA", category: "Theatre", group: "Leisure" },
    ]);
    expect(h.db.select().from(schema.groups).all()).toHaveLength(2);
  });

  it("keeps the suggestion when going back from More…", async () => {
    const h = setup("es");
    const { cinema } = await seed(h);
    h.runtime.llm = fakeLlm({ categoryId: cinema.id }).llm;

    const picker = await ingestPurchase(h);
    await h.tap(picker, "Más…");
    await h.tap(picker, "« Volver");

    expect(h.buttons(picker)?.[0]).toEqual(["✨ Cinema (Leisure)"]);
  });

  it("shows the picker without a suggestion when the provider fails or times out", async () => {
    const h = setup("es", fakeLlm(new Error("timeout")));
    await seed(h);

    const picker = await ingestPurchase(h);

    expect(h.buttons(picker)?.[0]).toEqual(["Cinema", "Delivery"]);
    expect(purchases(h)[0]).toMatchObject({
      suggestedCategoryId: null,
      suggestedCategoryName: null,
    });
  });

  it("drops output that names unknown ids or no usable name", async () => {
    const h = setup("es", fakeLlm({ categoryId: 999, newCategoryName: " ", groupId: 5 }));
    await seed(h);

    const picker = await ingestPurchase(h);

    expect(h.buttons(picker)?.flat()).not.toContainEqual(expect.stringMatching(/^✨/));
    expect(purchases(h)[0]?.suggestedCategoryId).toBeNull();
  });

  it("works without a provider (LLM_PROVIDER=none)", async () => {
    const h = setup("es");
    expect(h.runtime.config.LLM_PROVIDER).toBe("none");
    await seed(h);

    const picker = await ingestPurchase(h);

    expect(h.buttons(picker)?.[0]).toEqual(["Cinema", "Delivery"]);
  });

  it("is not asked when a merchant rule matches", async () => {
    const h = setup("es");
    const { cinema } = await seed(h);
    const fake = fakeLlm({ categoryId: cinema.id });
    h.runtime.llm = fake.llm;

    await h.tap(await ingestPurchase(h), "Cinema");
    await ingestPurchase(h);

    expect(fake.calls).toHaveLength(1);
    expect(purchases(h)[1]).toMatchObject({ categorizedBy: "rule", suggestedCategoryId: null });
  });
});
