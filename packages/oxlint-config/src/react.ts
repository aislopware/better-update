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
          {
            name: "@cloudflare/kumo",
            message:
              "Import Kumo through @better-update/ui/components/<name>. The barrel drags charts, maps and shiki into every chunk (~594 kB).",
          },
          {
            name: "@cloudflare/kumo/primitives",
            message:
              "Import the granular primitive: @better-update/ui/components/<name>, or @cloudflare/kumo/primitives/<name>.",
          },
        ],
      },
    ],

    "typescript/no-misused-promises": ["warn", { checksVoidReturn: { attributes: false } }],

    "react-perf/jsx-no-new-array-as-prop": "off",
    "react-perf/jsx-no-new-function-as-prop": "off",
    "react-perf/jsx-no-new-object-as-prop": "off",
    "react-perf/jsx-no-jsx-as-prop": "off",

    "react/jsx-max-depth": ["warn", { max: 9 }],
    "react/react-in-jsx-scope": "off",
    "react/jsx-filename-extension": "off",
    "react/no-multi-comp": "off",
    "react/forbid-component-props": "off",
    "react/only-export-components": "off",
    // New in oxlint 1.71. Targets i18n-mandated codebases where all copy must route through a
    // translation function; this dashboard ships English literals directly, so it just floods.
    "react/jsx-no-literals": "off",
    // oxlint 1.79 split the monolithic `react/react-compiler` rule into one rule per React
    // Compiler diagnostic, and the compiler now runs in the web build (vite.config.ts). Every
    // one of those rules flags a component the compiler bails out of — i.e. one that silently
    // keeps re-rendering unmemoized — so they all stay on, including the "incompatible library"
    // notices that made the old monolithic rule too noisy to keep. `react/todo` names syntax
    // oxc has not implemented yet, which reads like someone else's to-do but costs the same
    // bail-out, and the one case it found (`import()` inside a component) was fixable by
    // hoisting — so it stays on too.
    "react/todo": "warn",
    // Expressions over statements: components are arrow functions. New in oxlint 1.75.
    "react/function-component-definition": [
      "warn",
      { namedComponents: "arrow-function", unnamedComponents: "arrow-function" },
    ],
  },
  overrides: [
    {
      // The one place a React rule is legitimately suppressed: useMountEffect exists precisely
      // to hold the empty dependency array that exhaustive-deps objects to, and no phrasing of
      // it satisfies the rule (a hoisted deps constant is reported the same way). React Compiler
      // therefore skips this hook -- which costs nothing, since a one-line `useEffect(effect, [])`
      // wrapper has no render work to memoize.
      files: ["**/use-mount-effect.ts"],
      rules: { "react/rule-suppression": "off" },
    },
    {
      files: ["**/*.test.*", "**/*.spec.*", "**/__tests__/**", "**/tests/**"],
      rules: {
        // oxlint 1.65's jsx-a11y/control-has-associated-label does not detect
        // cross-element <label htmlFor>/<input id> association, only inline-child labels.
        // Test scaffolding forms intentionally use the htmlFor pattern.
        "jsx-a11y/control-has-associated-label": "off",
      },
    },
  ],
});
