import path from "node:path";

import { isRecord } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { Context, Data, Effect, Layer } from "effect";

import { CliRuntime } from "./cli-runtime";

const DEFAULT_BASE_URL = "https://better-update.dev";
const DEFAULT_WEB_URL = "https://better-update.dev";
const DEFAULT_ASSET_CDN_URL = "https://assets.better-update.dev";

class ConfigStoreParseError extends Data.TaggedError("ConfigStoreParseError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

const normalizeUrl = (value: string): string => value.replace(/\/$/u, "");

export class ConfigStore extends Context.Tag("cli/ConfigStore")<
  ConfigStore,
  {
    readonly getBaseUrl: Effect.Effect<string>;
    readonly getWebUrl: Effect.Effect<string>;
    /**
     * CDN origin that serves non-launch assets (`{cdn}/assets/{hash}`). The
     * deployed Worker serves regular assets ONLY from this origin (server
     * `ASSET_CDN_URL`), never from the API origin — so the CLI must render a
     * signed manifest's regular-asset URLs against THIS base, not `getBaseUrl`.
     * The launch bundle still routes to the API origin (`getBaseUrl`) so the
     * Worker can negotiate bsdiff. Resolves env → config file → default.
     */
    readonly getAssetCdnUrl: Effect.Effect<string>;
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
      Effect.orElseSucceed(() => ""),
      Effect.flatMap((content) =>
        content.length === 0
          ? Effect.void
          : Effect.try({
              try: (): unknown => JSON.parse(content),
              catch: (cause) =>
                new ConfigStoreParseError({
                  message: "Config file contains invalid JSON",
                  cause,
                }),
            }).pipe(
              Effect.map((parsed) => (isRecord(parsed) ? parsed : undefined)),
              Effect.orElseSucceed(() => undefined),
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

      getAssetCdnUrl: Effect.gen(function* () {
        const envUrl = yield* runtime.getEnv("BETTER_UPDATE_ASSET_CDN_URL");
        if (envUrl) {
          return normalizeUrl(envUrl);
        }

        const parsed = yield* readConfig;
        const assetCdnUrl = parsed?.["assetCdnUrl"];
        if (typeof assetCdnUrl === "string") {
          return normalizeUrl(assetCdnUrl);
        }

        return DEFAULT_ASSET_CDN_URL;
      }),
    };
  }),
);
