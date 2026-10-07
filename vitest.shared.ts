import type { Plugin } from "vite";

/** Loads `.yaml` files as raw text, matching the Workers/esbuild "Text" module rule. */
export const yamlAsText: Plugin = {
  name: "yaml-as-text",
  transform(code, id) {
    if (id.endsWith(".yaml")) return { code: `export default ${JSON.stringify(code)};`, map: null };
  },
};
