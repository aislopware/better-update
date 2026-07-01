import path from "node:path";

import { isRecord } from "@better-update/type-guards";
import { FileSystem, HttpClient, HttpClientRequest } from "@effect/platform";
import { Context, Effect, Layer } from "effect";

import { CliRuntime } from "./cli-runtime";
import { ConfigStore } from "./config-store";

// How long a fetched threshold stays fresh before the next command re-probes.
// Longer than the update-notice TTL: this runs a FOREGROUND probe on every stale
// invocation (it gates the command), so we trade killswitch latency for speed.
const CACHE_TTL_MS = 15 * 60 * 1000;
// The gate blocks the user's command, so the probe must give up fast and fall
// back to the cached value (or fail open) rather than hang the CLI on a slow net.
const FOREGROUND_TIMEOUT_MS = 1500;

interface VersionThresholdCacheEntry {
  readonly requireAbove: string;
  readonly checkedAt: number;
}

/**
 * Server-driven minimum-version killswitch. The server publishes a version
 * threshold at `/api/config` (`requireCliVersionAbove`, sourced from the
 * `REQUIRE_CLI_VERSION_ABOVE` Worker var); the CLI may run only if its version
 * is STRICTLY newer than it, letting the server retire a version with a
 * critical/incompatible bug. This resolves the threshold with a short-lived
 * on-disk cache and fails OPEN (returns `undefined`) whenever the server is
 * unreachable and nothing is cached — an outage must never brick a current CLI.
 */
export class MinVersionCheck extends Context.Tag("cli/MinVersionCheck")<
  MinVersionCheck,
  {
    readonly requireVersionAbove: Effect.Effect<string | undefined>;
  }
>() {}

export const MinVersionCheckLive = Layer.effect(
  MinVersionCheck,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const httpClient = yield* HttpClient.HttpClient;
    const runtime = yield* CliRuntime;
    const configStore = yield* ConfigStore;
    const homeDirectory = yield* runtime.homeDirectory;
    const cacheDir = path.join(homeDirectory, ".better-update");
    const cacheFile = path.join(cacheDir, "min-cli-version.json");

    const readCache: Effect.Effect<VersionThresholdCacheEntry | undefined> = Effect.gen(
      function* () {
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
          typeof parsed["requireAbove"] === "string" &&
          typeof parsed["checkedAt"] === "number"
        ) {
          return {
            requireAbove: parsed["requireAbove"],
            checkedAt: parsed["checkedAt"],
          } satisfies VersionThresholdCacheEntry;
        }
        return undefined;
      },
    );

    const fetchThreshold: Effect.Effect<string | undefined> = Effect.gen(function* () {
      const baseUrl = yield* configStore.getBaseUrl;
      const request = HttpClientRequest.get(`${baseUrl}/api/config`).pipe(
        HttpClientRequest.setHeader("accept", "application/json"),
      );
      const response = yield* httpClient.execute(request);
      if (response.status < 200 || response.status >= 300) {
        return undefined;
      }
      const body = yield* response.json;
      if (!isRecord(body) || typeof body["requireCliVersionAbove"] !== "string") {
        return undefined;
      }
      const requireAbove = body["requireCliVersionAbove"];
      yield* fs.makeDirectory(cacheDir, { recursive: true });
      yield* fs.writeFileString(
        cacheFile,
        `${JSON.stringify({ requireAbove, checkedAt: Date.now() }, null, 2)}\n`,
      );
      return requireAbove;
    }).pipe(
      Effect.timeout(FOREGROUND_TIMEOUT_MS),
      Effect.catchAll(() => Effect.succeed(undefined)),
    );

    return {
      requireVersionAbove: Effect.gen(function* () {
        const entry = yield* readCache;
        const fresh = entry !== undefined && Date.now() - entry.checkedAt <= CACHE_TTL_MS;
        if (fresh) {
          return entry.requireAbove;
        }
        // Stale or missing: probe the server. On failure fall back to the stale
        // cached value (a prior killswitch still bites offline) or fail open.
        const fetched = yield* fetchThreshold;
        return fetched ?? entry?.requireAbove;
      }),
    };
  }),
);
