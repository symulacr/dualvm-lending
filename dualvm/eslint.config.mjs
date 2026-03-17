import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Global ignores (must be standalone object with only "ignores")
  {
    ignores: [
      "artifacts/**",
      "cache/**",
      "dist/**",
      "node_modules/**",
      "out/**",
      "typechain-types/**",
      "coverage/**",
      "**/*.mjs",
      "**/*.js",
      "hardhat.config.ts",
      "hardhat.pvm.config.ts",
      "vite.config.ts",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Relax rules for hackathon codebase — catch bugs, not style
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "no-constant-condition": "off",
      "preserve-caught-error": "off",
    },
  },
  // Test files: allow chai-style unused expressions
  {
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
);
