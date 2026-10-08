import { describe, expect, it } from "vitest";
import { parseCommand, splitSetGroupArgs } from "./commands";

describe("parseCommand", () => {
  it.each([
    ["/pending", { name: "pending", args: "" }],
    ["/HELP", { name: "help", args: "" }],
    ["/setgroup@denarii_bot  Delivery  Food ", { name: "setgroup", args: "Delivery  Food" }],
    ["/setgroup Fast food\nFood", { name: "setgroup", args: "Fast food\nFood" }],
  ])("parses %j", (text, command) => {
    expect(parseCommand(text)).toEqual(command);
  });

  it.each(["pending", "", "/", "/123", "a /help"])("rejects %j", (text) => {
    expect(parseCommand(text)).toBeNull();
  });
});

describe("splitSetGroupArgs", () => {
  const categories = ["Delivery", "Fast food", "Fast"];
  const find = (name: string) => categories.find((c) => c.toLowerCase() === name.toLowerCase());

  it("splits a one-word category from the group", () => {
    expect(splitSetGroupArgs("delivery Food", find)).toEqual({
      category: "Delivery",
      group: "Food",
    });
  });

  it("prefers the longest category name and keeps a multi-word group", () => {
    expect(splitSetGroupArgs("Fast food Eating out", find)).toEqual({
      category: "Fast food",
      group: "Eating out",
    });
  });

  it("needs a group name after the category", () => {
    expect(splitSetGroupArgs("Delivery", find)).toBeNull();
  });

  it("returns null for an unknown category", () => {
    expect(splitSetGroupArgs("Cinema Leisure", find)).toBeNull();
  });
});
