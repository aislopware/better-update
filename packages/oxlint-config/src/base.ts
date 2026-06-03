import { defineConfig } from "oxlint";

export default defineConfig({
  categories: {
    correctness: "warn",
    suspicious: "warn",
    pedantic: "warn",
    perf: "warn",
    style: "warn",
    restriction: "warn",
    nursery: "warn",
  },
  plugins: ["typescript", "unicorn", "oxc", "import", "vitest", "jsdoc", "node", "promise"],
  jsPlugins: ["eslint-plugin-functional", "oxlint-plugin-eslint"],
  rules: {
    "eslint-js/no-restricted-syntax": [
      "error",
      {
        selector: "LogicalExpression[operator='??'][right.type='Literal'][right.value='']",
        message:
          "Silent empty-string fallback hides missing data. Use `yield* requireValue(x, 'fieldName')` or move default into Schema.optionalWith.",
      },
      {
        selector: "LogicalExpression[operator='||'][right.type='Literal'][right.value='']",
        message:
          "Silent empty-string fallback hides missing data. Use `yield* requireValue(x, 'fieldName')` or move default into Schema.optionalWith.",
      },
      {
        selector: "LogicalExpression[operator='??'][right.type='Literal'][right.raw='null']",
        message:
          "Use toDbNull() for DB nullable-column inserts or Option.fromNullable for domain absence.",
      },
      {
        selector:
          "LogicalExpression[operator='??'][right.type='Identifier'][right.name='undefined']",
        message:
          "Use toOptional() for null→undefined type normalization or Schema.optionalWith({ default }) for defaults.",
      },
      {
        selector: "CallExpression > ArrowFunctionExpression.callee",
        message:
          "Anonymous arrow IIFE forbidden. Extract to a named arrow function (const helper = () => {...}) above the call site.",
      },
      {
        selector: "CallExpression > FunctionExpression.callee",
        message:
          "Anonymous function IIFE forbidden. Extract to a named function above the call site.",
      },
    ],

    "promise/prefer-await-to-then": ["warn", { strict: true }],
    "promise/always-return": "off",
    "promise/avoid-new": "off",
    "promise/catch-or-return": "off",
    "promise/no-callback-in-promise": "off",
    "promise/no-multiple-resolved": "off",
    "promise/no-nesting": "off",
    "promise/no-new-statics": "off",
    "promise/no-promise-in-callback": "off",
    "promise/no-return-in-finally": "off",
    "promise/no-return-wrap": "off",
    "promise/param-names": "off",
    "promise/prefer-await-to-callbacks": "off",
    "promise/prefer-catch": "off",
    "promise/spec-only": "off",
    "promise/valid-params": "off",

    "functional/immutable-data": "off",
    "functional/no-let": "warn",
    "functional/no-loop-statements": "warn",
    "functional/no-promise-reject": "warn",
    "functional/no-throw-statements": "warn",
    "functional/no-try-statements": "warn",

    "capitalized-comments": "off",
    "constructor-super": "off",
    "func-names": ["warn", "as-needed", { generators: "never" }],
    "getter-return": "off",
    "max-classes-per-file": ["warn", { max: 5, ignoreExpressions: true }],
    "max-lines": ["warn", { max: 500 }],
    "max-lines-per-function": [
      "warn",
      { max: 250, skipBlankLines: true, skipComments: true, IIFEs: true },
    ],
    "max-params": ["warn", 5],
    "max-statements": ["warn", 25],
    "new-cap": ["warn", { properties: false }],
    "id-length": ["warn", { min: 2, exceptions: ["_", "T", "K", "V", "R"] }],
    "no-console": "warn",
    "no-underscore-dangle": ["warn", { allow: ["_tag"] }],
    "no-const-assign": "off",
    "no-dupe-class-members": "off",
    "no-dupe-keys": "off",
    "no-func-assign": "off",
    "no-import-assign": "off",
    "no-magic-numbers": "off",
    "no-new-native-nonconstructor": "off",
    "no-obj-calls": "off",
    "no-plusplus": "off",
    "no-redeclare": "off",
    "no-setter-return": "off",
    "no-ternary": "off",
    "no-this-before-super": "off",
    "no-undef": "off",
    "no-undefined": "off",
    "no-unreachable": "off",
    "no-use-before-define": "off",
    "require-await": "off",
    "require-yield": "off",
    "no-duplicate-imports": "off",
    "sort-imports": "off",
    "sort-keys": "off",

    "typescript/strict-void-return": "off",
    "typescript/explicit-function-return-type": "off",
    "typescript/strict-boolean-expressions": "off",
    "typescript/explicit-module-boundary-types": "off",
    "typescript/prefer-readonly-parameter-types": "off",
    "typescript/prefer-nullish-coalescing": "off",
    // Conflicts with the Effect idiom `return yield* <error>` (the @effect/language-service
    // `missingReturnYieldStar` diagnostic). `yield* error` is `never`-typed, so a generator
    // that exits via `return yield* error` on some branches and falls through to void on others
    // is type-safe, but consistent-return (not `never`-aware) flags it. Effect LS wins here.
    "typescript/consistent-return": "off",

    "unicorn/filename-case": "off",
    "unicorn/no-abusive-eslint-disable": "off",
    "unicorn/no-array-reduce": "off",
    "unicorn/prefer-math-trunc": "off",
    "unicorn/no-array-callback-reference": "off",
    "unicorn/no-array-for-each": "off",
    "unicorn/no-nested-ternary": "off",
    "unicorn/no-null": "off",
    "unicorn/no-useless-undefined": "off",

    "import/exports-last": "off",
    "import/group-exports": "off",
    "import/no-default-export": "off",
    "import/no-named-export": "off",
    "import/no-relative-parent-imports": "off",
    "import/prefer-default-export": "off",
    "import/max-dependencies": "off",
    "import/no-unassigned-import": ["warn", { allow: ["**/*.css", "**/*.scss"] }],

    "jsdoc/require-param": "off",
    "jsdoc/require-returns": "off",
    // @effect/language-service config tags (effect-tsgo). These are read by the
    // Effect LS, not standard JSDoc — register them so check-tag-names accepts them.
    "jsdoc/check-tag-names": [
      "warn",
      {
        definedTags: [
          "effect-expect-leaking",
          "effect-leakable-service",
          "effect-diagnostics",
          "effect-diagnostics-next-line",
        ],
      },
    ],

    "oxc/no-accumulating-spread": "off",
    "oxc/no-async-await": "off",
    "oxc/no-optional-chaining": "off",
    "oxc/no-rest-spread-properties": "off",

    "vitest/prefer-called-once": "off",
    "vitest/prefer-to-be-truthy": "off",
    "vitest/prefer-to-be-falsy": "off",
    "vitest/prefer-lowercase-title": "off",
    "vitest/require-hook": "off",

    "jest/prefer-importing-jest-globals": "off",
    "jest/no-standalone-expect": "off",
    "jest/max-expects": "off",
    "jest/valid-title": "off",
    "jest/prefer-ending-with-an-expect": "off",
    "jest/prefer-lowercase-title": "off",
    "jest/no-conditional-in-test": "off",
    "jest/no-hooks": "off",
    "jest/no-conditional-expect": "off",
    "jest/valid-expect": "off",
    "jest/require-top-level-describe": "off",
    "jest/expect-expect": "off",
    "jest/no-untyped-mock-factory": "off",
    "jest/prefer-mock-return-shorthand": "off",
  },
  overrides: [
    {
      files: ["**/*.machine.ts"],
      rules: {
        "typescript/no-unsafe-type-assertion": "off",
      },
    },
    {
      files: ["**/*.test.*", "**/*.spec.*", "**/__tests__/**", "**/tests/**"],
      rules: {
        "eslint-js/no-restricted-syntax": "off",
        "init-declarations": "off",
        "max-lines-per-function": "off",
        "max-lines": "off",
        "max-statements": "off",
        "no-magic-numbers": "off",

        "functional/no-let": "off",
        "functional/no-loop-statements": "off",
        "functional/no-throw-statements": "off",
        "functional/no-promise-reject": "off",
        "functional/no-try-statements": "off",
        "promise/prefer-await-to-then": "off",
        "typescript/require-await": "off",

        "import/no-nodejs-modules": "off",
        "import/no-unassigned-import": "off",

        "typescript/no-confusing-void-expression": "off",
        "typescript/no-unsafe-type-assertion": "off",
        "typescript/no-empty-function": "off",
        "typescript/no-explicit-any": "off",
        "typescript/no-non-null-assertion": "off",
        "typescript/no-unsafe-argument": "off",
        "typescript/no-unsafe-assignment": "off",
        "typescript/no-unsafe-call": "off",
        "typescript/no-unsafe-member-access": "off",
        "typescript/no-unsafe-return": "off",

        "unicorn/consistent-function-scoping": "off",

        "vitest/require-test-timeout": "off",
        "vitest/prefer-importing-vitest-globals": "off",
        "vitest/valid-title": "off",
        "vitest/prefer-expect-assertions": "off",
        "vitest/max-expects": "off",
        "vitest/no-conditional-expect": "off",
        "vitest/no-conditional-in-test": "off",
        "vitest/no-hooks": "off",
        "vitest/no-standalone-expect": "off",
        "vitest/prefer-mock-return-shorthand": "off",
        "vitest/require-top-level-describe": "off",
        "vitest/expect-expect": "off",

        "require-unicode-regexp": "off",

        "jest/prefer-expect-assertions": "off",
      },
    },
  ],
  ignorePatterns: [
    "dist",
    "node_modules",
    ".turbo",
    "**/*.gen.ts",
    "**/*.d.ts",
    "coverage",
    "vitest.config.*",
  ],
  options: {
    typeAware: true,
    denyWarnings: true,
    reportUnusedDisableDirectives: "warn",
    typeCheck: true,
  },
});
