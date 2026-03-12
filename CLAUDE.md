# Agent Project Guidance

## Agent Behavior

- Use package manager: `bun`, `bunx` for script execution. Do not use `npm`, `npx`, or `yarn` for running scripts or managing dependencies.
- Do not run `oxlint` or `tsgo` directly; they are part of the `lint` script. Use `bun run lint` for both linting and typechecking.
- Do not disable existing lint rules. If a rule is conflicted or annoying, should stop and ask for clarification instead of disabling it. If a rule needs to be disabled, it should be done globally in the base configuration file, not in package-scoped config files.
