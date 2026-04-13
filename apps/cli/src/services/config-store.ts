import { FileSystem } from "@effect/platform";
import { Context, Effect, Layer } from "effect";

const DEFAULT_BASE_URL = "https://api.better-update.dev";
const DEFAULT_DASHBOARD_URL = "https://better-update.dev";

const normalizeUrl = (value: string): string => value.replace(/\/$/, "");

const deriveDashboardUrl = (serverUrl: string): string => {
  const normalized = normalizeUrl(serverUrl);

  try {
    const url = new URL(normalized);

    if (url.hostname.startsWith("api.")) {
      url.hostname = url.hostname.slice(4);
      return normalizeUrl(url.toString());
    }

    if (url.pathname === "/api") {
      url.pathname = "/";
      return normalizeUrl(url.toString());
    }

    return normalized;
  } catch {
    return DEFAULT_DASHBOARD_URL;
  }
};

export class ConfigStore extends Context.Tag("cli/ConfigStore")<
  ConfigStore,
  {
    readonly getBaseUrl: Effect.Effect<string>;
    readonly getDashboardUrl: Effect.Effect<string>;
  }
>() {}

const configFile = `${process.env["HOME"]}/.better-update/config.json`;

export const ConfigStoreLive = Layer.effect(
  ConfigStore,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const readConfig = fs.readFileString(configFile).pipe(
      Effect.catchAll(() => Effect.succeed("")),
      Effect.flatMap((content) =>
        content.length === 0
          ? Effect.succeed(undefined)
          : Effect.try(() => JSON.parse(content) as Record<string, unknown>).pipe(
              Effect.catchAll(() => Effect.succeed(undefined)),
            ),
      ),
    );
    const resolveBaseUrl = Effect.gen(function* () {
      const envUrl = process.env["BETTER_UPDATE_URL"];
      if (envUrl) return normalizeUrl(envUrl);

      const parsed = yield* readConfig;
      const serverUrl = parsed?.["serverUrl"];
      if (typeof serverUrl === "string") return normalizeUrl(serverUrl);

      return DEFAULT_BASE_URL;
    });

    return {
      getBaseUrl: resolveBaseUrl,

      getDashboardUrl: Effect.gen(function* () {
        const envUrl = process.env["BETTER_UPDATE_DASHBOARD_URL"];
        if (envUrl) return normalizeUrl(envUrl);

        const parsed = yield* readConfig;
        const dashboardUrl = parsed?.["dashboardUrl"];
        if (typeof dashboardUrl === "string") return normalizeUrl(dashboardUrl);

        const serverUrl = yield* resolveBaseUrl;
        return deriveDashboardUrl(serverUrl);
      }),
    };
  }),
);
