import { defineConfig } from "oxlint";

import base from "./base.ts";

export default defineConfig({
  extends: [base],
  plugins: [
    "typescript",
    "unicorn",
    "oxc",
    "react",
    "react-perf",
    "import",
    "jsx-a11y",
    "promise",
    "vitest",
    "jsdoc",
    "node",
  ],
  jsPlugins: ["@tanstack/eslint-plugin-router"],
  rules: {
    "@tanstack/router/create-route-property-order": "warn",
    "@tanstack/router/route-param-names": "warn",

    "no-restricted-imports": [
      "warn",
      {
        paths: [
          {
            name: "react",
            importNames: ["useEffect", "useLayoutEffect"],
            message:
              "Do not use useEffect/useLayoutEffect. Use useMountEffect for mount-only side effects, XState actors for stateful side effects, or TanStack Router loaders for data fetching.",
          },
        ],
      },
    ],

    "typescript/no-misused-promises": ["warn", { checksVoidReturn: { attributes: false } }],

    "react-perf/jsx-no-new-array-as-prop": "off",
    "react-perf/jsx-no-new-function-as-prop": "off",
    "react-perf/jsx-no-new-object-as-prop": "off",
    "react-perf/jsx-no-jsx-as-prop": "off",

    "react/jsx-max-depth": ["warn", { max: 7 }],
    "react/react-in-jsx-scope": "off",
    "react/jsx-filename-extension": "off",
    "react/no-multi-comp": "off",
    "react/forbid-component-props": "off",
    "react/only-export-components": "off",
  },
});
