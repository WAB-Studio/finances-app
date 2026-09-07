import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "private/**",
  ]),
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name='insert']",
          message:
            "Insert through `insertRow` (db/insert-row.ts). Drizzle's insert builder names every column of the table and the per-column INSERT grants refuse it.",
        },
      ],
    },
  },
  // The RLS harness calls the builder on purpose, as the negative control that
  // shows the grants refusing it.
  {
    files: ["scripts/check-rls.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
]);

export default eslintConfig;
