// Loads rule packs (`.yaml`) as raw text, like the Workers "Text" module rule. Used with
// `tsx --import`, since Node has no bundler step.
import { register } from "node:module";

register("./yaml-hooks.mjs", import.meta.url);
