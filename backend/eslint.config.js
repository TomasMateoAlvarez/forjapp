// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // El código existente usa unused args con prefijo _ (ej. _req) a propósito.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  }
);
