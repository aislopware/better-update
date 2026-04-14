import process from "node:process";

import { Context, Effect, Layer } from "effect";

const definedEnvironment = (): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value] as const] : [],
    ),
  );

export class CliRuntime extends Context.Tag("cli/CliRuntime")<
  CliRuntime,
  {
    readonly argv: ReadonlyArray<string>;
    readonly platform: NodeJS.Platform;
    readonly cwd: Effect.Effect<string>;
    readonly getEnv: (name: string) => Effect.Effect<string | undefined>;
    readonly homeDirectory: Effect.Effect<string>;
    readonly userName: Effect.Effect<string>;
    readonly commandEnvironment: (
      overrides?: Readonly<Record<string, string>>,
    ) => Effect.Effect<Readonly<Record<string, string>>>;
    readonly setExitCode: (code: number) => Effect.Effect<void>;
  }
>() {}

export const CliRuntimeLive = Layer.succeed(CliRuntime, {
  argv: [...process.argv],
  platform: process.platform,
  cwd: Effect.sync(() => process.cwd()),
  getEnv: (name: string) => Effect.sync(() => process.env[name]),
  homeDirectory: Effect.sync(
    () => process.env["HOME"] ?? process.env["USERPROFILE"] ?? process.cwd(),
  ),
  userName: Effect.sync(() => process.env["USER"] ?? process.env["USERNAME"] ?? "better-update"),
  commandEnvironment: (overrides = {}) =>
    Effect.sync(() => ({
      ...definedEnvironment(),
      ...overrides,
    })),
  setExitCode: (code: number) =>
    Effect.sync(() => {
      process.exitCode = code;
    }),
});
