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
