// Bundlers load rule packs as raw text (Workers "Text" module rule, Vitest yamlAsText plugin).
declare module "*.yaml" {
  const source: string;
  export default source;
}
