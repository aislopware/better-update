import path from "node:path";

import { isRecord } from "@better-update/type-guards";
import { FileSystem, HttpClient, HttpClientRequest } from "@effect/platform";
import { Context, Effect, Layer } from "effect";

import { CliRuntime } from "./cli-runtime";

const NPM_REGISTRY_URL = "https://registry.npmjs.org/@better-update/cli/latest";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REFRESH_TIMEOUT_MS = 3000;

interface VersionCacheEntry {
  readonly latest: string;
  readonly checkedAt: number;
}

export class VersionCheck extends Context.Tag("cli/VersionCheck")<
  VersionCheck,
  {
    readonly cachedLatest: Effect.Effect<string | undefined>;
    readonly cacheStale: Effect.Effect<boolean>;
    readonly refreshCache: Effect.Effect<void>;
  }
>() {}

export const VersionCheckLive = Layer.effect(
  VersionCheck,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const httpClient = yield* HttpClient.HttpClient;
    const runtime = yield* CliRuntime;
    const homeDirectory = yield* runtime.homeDirectory;
    const cacheDir = path.join(homeDirectory, ".better-update");
    const cacheFile = path.join(cacheDir, "version-check.json");

    const readCache: Effect.Effect<VersionCacheEntry | undefined> = Effect.gen(function* () {
      const content = yield* fs.readFileString(cacheFile).pipe(Effect.orElseSucceed(() => ""));
      if (content.length === 0) {
        return undefined;
      }
      const parsed = yield* Effect.try({
        try: (): unknown => JSON.parse(content),
        catch: () => "parse-error" as const,
      }).pipe(Effect.orElseSucceed(() => undefined));
      if (
        isRecord(parsed) &&
        typeof parsed["latest"] === "string" &&
        typeof parsed["checkedAt"] === "number"
      ) {
        return {
          latest: parsed["latest"],
          checkedAt: parsed["checkedAt"],
        } satisfies VersionCacheEntry;
      }
      return undefined;
    });

    return {
      cachedLatest: readCache.pipe(Effect.map((entry) => entry?.latest)),
      cacheStale: readCache.pipe(
        Effect.map((entry) => {
          if (!entry) {
            return true;
          }
          const elapsed = Date.now() - entry.checkedAt;
          return elapsed < 0 || elapsed > CACHE_TTL_MS;
        }),
      ),
      refreshCache: Effect.gen(function* () {
        const request = HttpClientRequest.get(NPM_REGISTRY_URL).pipe(
          HttpClientRequest.setHeader("accept", "application/json"),
        );
        const response = yield* httpClient.execute(request);
        if (response.status < 200 || response.status >= 300) {
          return;
        }
        const body = yield* response.json;
        if (!isRecord(body) || typeof body["version"] !== "string") {
          return;
        }
        const latest = body["version"];
        yield* fs.makeDirectory(cacheDir, { recursive: true });
        yield* fs.writeFileString(
          cacheFile,
          `${JSON.stringify({ latest, checkedAt: Date.now() }, null, 2)}\n`,
        );
      }).pipe(
        Effect.timeout(REFRESH_TIMEOUT_MS),
        Effect.catchAll(() => Effect.void),
      ),
    };
  }),
);
