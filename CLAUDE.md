# Agent Project Guidance

## Agent Behavior

- Use package manager: `bun`, `bunx` for script execution. Do not use `npm`, `npx`, or `yarn` for running scripts or managing dependencies.
- Do not run `oxlint` or `tsgo` directly; they are part of the `lint` script. Use `bun run lint` for both linting and typechecking.
- Do not disable existing lint rules. If a rule is conflicted or annoying, should stop and ask for clarification instead of disabling it. If a rule needs to be disabled, it should be done globally in the base configuration file, not in package-scoped config files.

## Side Effects

- Do not use `useEffect` or `useLayoutEffect`. Use `useMountEffect` from `@better-update/react-hooks` for mount-only side effects instead.
- Do not fetch data in effects. Use TanStack React Query (`@tanstack/react-query`) instead.
- Do not manage complex async flows in hooks. Use XState v5 actors (`fromPromise`, `fromCallback`, state machines via `@xstate/react`) instead.
- Do not compute derived values in effects. Calculate during render or use `useMemo` instead.

## Error Handling

- Do not use `try/catch`. Use Effect-TS (`effect`) instead.
- Do not use `throw`. Use `Effect.fail` and `Data.TaggedError` to return typed errors instead.
- Do not use `Promise.reject()`. Use `Effect.tryPromise` to wrap external async APIs instead.
- Do not use async/await with try/catch. Use `Effect.gen` for async pipelines instead.
- Use Layers and Services for dependency injection.

## Immutability

- Do not use `let`. Use `const` instead.
- Do not use for/while loops. Use `map`, `filter`, `reduce`, or Effect-TS pipe patterns instead.
- Do not mutate objects or arrays. Create new values instead.

## Type Safety

- Do not use `as` type assertions. Use type narrowing, type predicates, or `satisfies` instead. Exception: branded type smart constructors.
- Model variants as discriminated unions with a literal `_tag`, `kind`, or `type` property.
- Use `assertNever(x: never): never` in default branches of switch statements over discriminated unions for runtime safety.
- Narrow types via control flow (`typeof`, `in`, `instanceof`, discriminant checks) instead of casting. Write type predicate functions (`x is T`) for reusable guards. Use assertion functions (`asserts x is T`) for invariant checks.
- Use `Readonly<>` for function parameters and React component props. Use `ReadonlyDeep<>` from `type-fest` for nested immutability.
- Use `satisfies` to validate object shapes while preserving literal type inference. Prefer over type annotations for config objects, route tables, and lookup maps.
- Use `as const` objects with derived union types for enum-like constants. Use `const` type parameters to infer literal types from call sites.
- Use `Brand` from `effect` for domain-specific primitives (UserId, OrderId, EmailAddress). Use `Brand.nominal` for type distinction only, `Brand.refined` when runtime validation is needed, and `Schema.brand` when parsing from external input.
- Use `NoInfer<T>` for generic function parameters that should validate against an inferred type but not contribute to inference (defaults, initial values, fallbacks).
- Use template literal types to constrain string parameters to valid patterns (event names, route paths, CSS units).
- Use `Except<T, K>` from `type-fest` instead of `Omit<T, K>`. `Except` errors on non-existent keys, catching typos during refactoring.
- Use `Merge<A, B>` from `type-fest` instead of `A & B` for object type composition. `Merge` correctly handles overrides and index signatures.
- Use `ReadonlyDeep<T>` from `type-fest` instead of `Readonly<T>` when nested immutability is needed.
- Use `Simplify<T>` from `type-fest` to flatten complex intersection types for readable IDE output.
- Use `LiteralUnion<Literals, Base>` from `type-fest` to preserve IDE autocomplete when accepting both known literals and arbitrary strings.
- Use `RequireAtLeastOne<T, K>` or `RequireExactlyOne<T, K>` from `type-fest` for config objects where at least/exactly one option must be provided.
- Use `JsonValue` and `Jsonify<T>` from `type-fest` for typing JSON-serialized data. `Jsonify` models what `JSON.parse(JSON.stringify(x))` actually produces.
- Use `SetOptional<T, K>` and `SetRequired<T, K>` from `type-fest` for surgical optional/required adjustments on specific keys.
- Do not bypass type safety when these guidelines do not cover a specific situation. Look up official documentation, library type signatures, or community patterns for a type-safe approach instead.
