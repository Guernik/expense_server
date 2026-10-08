import { describe, expect, it } from "vitest";
import type { Category, Group } from "../ports";
import { validateSuggestion } from "./suggestion";

const food: Group = { id: 1, name: "Food" };
const leisure: Group = { id: 2, name: "Leisure" };
const groups = [food, leisure];
const categories: Category[] = [
  { id: 10, name: "Delivery", group: food },
  { id: 11, name: "Cinema", group: leisure },
];

describe("validateSuggestion", () => {
  it("accepts an existing category id", () => {
    expect(validateSuggestion({ categoryId: 11 }, categories, groups)).toEqual({ categoryId: 11 });
  });

  it("maps a new name that already exists to that category", () => {
    expect(
      validateSuggestion({ newCategoryName: "cinema", newGroupName: "Fun" }, categories, groups),
    ).toEqual({ categoryId: 11 });
  });

  it("accepts a new category in an existing group", () => {
    expect(
      validateSuggestion({ newCategoryName: " Theatre ", groupId: 2 }, categories, groups),
    ).toEqual({ categoryName: "Theatre", groupName: "Leisure" });
  });

  it("accepts a new category in a new group", () => {
    expect(
      validateSuggestion(
        { categoryId: null, newCategoryName: "Fuel", groupId: null, newGroupName: "Transport" },
        categories,
        groups,
      ),
    ).toEqual({ categoryName: "Fuel", groupName: "Transport" });
  });

  it.each([
    { categoryId: 99 },
    {},
    { newCategoryName: "Fuel" },
    { newCategoryName: "Fuel", groupId: 99 },
    { newCategoryName: "", newGroupName: "Transport" },
    { newCategoryName: "/start", newGroupName: "Transport" },
    { newCategoryName: "x".repeat(41), newGroupName: "Transport" },
    { newCategoryName: "Fuel", newGroupName: "x".repeat(41) },
  ])("rejects %j", (output) => {
    expect(validateSuggestion(output, categories, groups)).toBeNull();
  });
});
