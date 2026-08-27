import { defineConfig, globalIgnores } from "eslint/config";
import eslint from "@eslint/js";
import next from "@next/eslint-plugin-next";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  globalIgnores([
    ".next/**",
    "dist/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat["jsx-runtime"],
  reactHooks.configs.flat["recommended-latest"],
  jsxA11y.flatConfigs.recommended,
  next.configs["core-web-vitals"],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      /*
       * Cyclomatic complexity, as a warning rather than an error.
       *
       * It is a warning because 21 functions in this repository are already
       * over 15 and several are well over it: the landing surface, the
       * humanize and checkout route handlers, the sign-in request builder,
       * the sentence segmenter, the benchmark runners. Every one of them is
       * shipped, covered, and correct as far as the suite can tell, and
       * turning this on as an error today would mean refactoring all of them
       * at once, in one change, with no behavioural test asking for it. That
       * is how a lint rule buys a regression.
       *
       * So it is a ratchet instead. New code is measured the moment it is
       * written, the existing offenders are named on every run rather than
       * hidden, and the number below comes down as they are broken up. When
       * the count reaches zero this becomes "error".
       *
       * 15, not ESLint's suggested 20: at 20 the rule says nothing about a
       * function with nineteen independent paths, which is already past what
       * a reviewer can hold in their head or a test suite can cover
       * exhaustively.
       */
      complexity: ["warn", 15],
    },
  },
]);

export default eslintConfig;
