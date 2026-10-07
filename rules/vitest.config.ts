import { defineConfig } from "vitest/config";
import { yamlAsText } from "../vitest.shared.ts";

export default defineConfig({ plugins: [yamlAsText] });
