import { parsePack, runPackTests } from "@denarii/core";
import { describe, expect, it } from "vitest";
import { PACK_SOURCES } from "./index";

describe("bundled rule packs", () => {
  const packs = Object.entries(PACK_SOURCES).map(([name, yaml]) => parsePack(name, yaml));

  it("all rule ids are unique", () => {
    const ids = packs.flatMap((p) => p.rules.map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(packs.map((p) => [p.pack, p] as const))("%s passes its inline tests", (_, pack) => {
    expect(runPackTests([pack])).toEqual([]);
  });

  it("pass their inline tests with every pack enabled", () => {
    expect(runPackTests(packs)).toEqual([]);
  });
});
