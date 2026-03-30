# Agent Project Guidance

## Agent Behavior

- Use package manager: `bun`, `bunx` for script execution. Do not use `npm`, `npx`, or `yarn` for running scripts or managing dependencies.
- Do not run `oxlint` or `tsgo` directly; they are part of the `lint` script. Use `bun run lint` for both linting and typechecking.
- Do not disable existing lint rules. If a rule is conflicted or annoying, should stop and ask for clarification instead of disabling it. If a rule needs to be disabled, it should be done globally in the base configuration file, not in package-scoped config files.

## Skill Triggers

Before writing or modifying code, trigger relevant skills for up-to-date patterns. Do not rely on training data. The cost of an unnecessary skill call is near zero — skipping a relevant one leads to suboptimal patterns.

| File types     | Trigger skills                           |
| -------------- | ---------------------------------------- |
| `.ts`, `.tsx`  | `typescript-advanced`, `effect-advanced` |
| `.tsx`, `.jsx` | `react-advanced`, `react-web-advanced`   |
