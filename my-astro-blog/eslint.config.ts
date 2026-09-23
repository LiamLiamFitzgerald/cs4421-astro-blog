import eslintPluginAstro from "eslint-plugin-astro";
import tseslint from "typescript-eslint";
import type { Linter } from "eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", ".astro/**", "node_modules/**"],
  },
  tseslint.configs.recommended,
  eslintPluginAstro.configs.recommended,
) satisfies Linter.Config[];
);
