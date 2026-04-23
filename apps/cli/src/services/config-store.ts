import path from "node:path";

import { FileSystem } from "@effect/platform";
import { Context, Data, Effect, Layer } from "effect";

import { isRecord } from "../lib/record";
import { CliRuntime } from "./cli-runtime";

const DEFAULT_BASE_URL = "https://graph.better-update.dev";
const DEFAULT_WEB_URL = "https://better-update.dev";

class ConfigStoreParseError extends Data.TaggedError("ConfigStoreParseError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

const normalizeUrl = (value: string): string => value.replace(/\/$/, "");

export class ConfigStore extends Context.Tag("cli/ConfigStore")<
  ConfigStore,
  {
    readonly getBaseUrl: Effect.Effect<string>;
    readonly getWebUrl: Effect.Effect<string>;
  }
>() {}

export const ConfigStoreLive = Layer.effect(
  ConfigStore,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const runtime = yield* CliRuntime;
    const homeDirectory = yield* runtime.homeDirectory;
    const configFile = path.join(homeDirectory, ".better-update", "config.json");
    const readConfig = fs.readFileString(configFile).pipe(
      Effect.catchAll(() => Effect.succeed("")),
      Effect.flatMap((content) =>
        content.length === 0
          ? Effect.succeed(undefined)
          : Effect.try({
              try: (): unknown => JSON.parse(content),
              catch: (cause) =>
                new ConfigStoreParseError({
                  message: "Config file contains invalid JSON",
                  cause,
                }),
            }).pipe(
              Effect.map((parsed) => (isRecord(parsed) ? parsed : undefined)),
              Effect.catchAll(() => Effect.succeed(undefined)),
            ),
      ),
    );
    const resolveBaseUrl = Effect.gen(function* () {
      const envUrl = yield* runtime.getEnv("BETTER_UPDATE_URL");
      if (envUrl) {
        return normalizeUrl(envUrl);
      }

      const parsed = yield* readConfig;
      const baseUrl = parsed?.["baseUrl"];
      if (typeof baseUrl === "string") {
        return normalizeUrl(baseUrl);
      }

      return DEFAULT_BASE_URL;
    });

    return {
      getBaseUrl: resolveBaseUrl,

      getWebUrl: Effect.gen(function* () {
        const envUrl = yield* runtime.getEnv("BETTER_UPDATE_WEB_URL");
        if (envUrl) {
          return normalizeUrl(envUrl);
        }

        const parsed = yield* readConfig;
        const webUrl = parsed?.["webUrl"];
        if (typeof webUrl === "string") {
          return normalizeUrl(webUrl);
        }

        return DEFAULT_WEB_URL;
      }),
    };
  }),
);
