import { type CompiledRule, compileRules, parsePack } from "@denarii/core";
import { PACK_SOURCES } from "@denarii/rules";

let cache: { key: string; rules: CompiledRule[] } | undefined;

/** Compiles the enabled bundled packs once per isolate. */
export function loadRules(packNames: string[]): CompiledRule[] {
  const key = packNames.join(",");
  if (cache?.key === key) return cache.rules;
  const packs = packNames.map((name) => {
    const source = PACK_SOURCES[name];
    if (source === undefined) {
      throw new Error(
        `Unknown rule pack "${name}". Available: ${Object.keys(PACK_SOURCES).join(", ")}`,
      );
    }
    return parsePack(name, source);
  });
  cache = { key, rules: compileRules(packs) };
  return cache.rules;
}
