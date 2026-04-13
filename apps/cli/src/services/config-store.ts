import { FileSystem } from "@effect/platform";
import { Context, Effect, Layer } from "effect";

const DEFAULT_BASE_URL = "https://api.better-update.dev";

export class ConfigStore extends Context.Tag("cli/ConfigStore")<
  ConfigStore,
  {
    readonly getBaseUrl: Effect.Effect<string>;
  }
>() {}

const configFile = `${process.env["HOME"]}/.better-update/config.json`;

export const ConfigStoreLive = Layer.effect(
  ConfigStore,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    return {
      getBaseUrl: Effect.gen(function* () {
        const envUrl = process.env["BETTER_UPDATE_URL"];
        if (envUrl) return envUrl;

        const content = yield* fs
          .readFileString(configFile)
          .pipe(Effect.catchAll(() => Effect.succeed("")));

        if (content) {
          const parsed = yield* Effect.try(
            () => JSON.parse(content) as Record<string, unknown>,
          ).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
          const serverUrl = parsed?.["serverUrl"];
          if (typeof serverUrl === "string") return serverUrl;
        }

        return DEFAULT_BASE_URL;
      }),
    };
  }),
);
