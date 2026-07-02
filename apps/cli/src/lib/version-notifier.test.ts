import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { CliRuntime } from "../services/cli-runtime";
import { VersionCheck } from "../services/version-check";
import { bootstrapVersionCheck } from "./version-notifier";

// A newer cached version is available + the cache is fresh, so the only variable
// across these tests is whether the upgrade notice is emitted. The notice goes
// to stderr (Console.error), never stdout, so it cannot corrupt the JSON
// envelope — but EAS suppresses it under --json/CI and so do we (P4).

interface VersionConfig {
  readonly cachedLatest: string | undefined;
  readonly fetchLatest: string | undefined;
}

const DEFAULT_VERSION_CONFIG: VersionConfig = { cachedLatest: "9.9.9", fetchLatest: undefined };

const makeVersionCheckLayer = (config: VersionConfig = DEFAULT_VERSION_CONFIG) =>
  Layer.succeed(VersionCheck, {
    cachedLatest: Effect.succeed(config.cachedLatest),
    cacheStale: Effect.succeed(false),
    fetchLatest: Effect.succeed(config.fetchLatest),
    refreshCache: Effect.void,
  });

const makeRuntimeLayer = (optedOut: boolean) =>
  Layer.succeed(CliRuntime, {
    argv: [],
    platform: "darwin",
    cwd: Effect.succeed("/"),
    getEnv: (name: string) =>
      Effect.succeed(
        name === "BETTER_UPDATE_DISABLE_UPDATE_NOTIFIER" && optedOut ? "1" : undefined,
      ),
    homeDirectory: Effect.succeed("/home/test"),
    userName: Effect.succeed("test"),
    commandEnvironment: () => Effect.succeed({}),
    setExitCode: () => Effect.void,
  });

const run = async (
  options: Parameters<typeof bootstrapVersionCheck>[3],
  optedOut = false,
  versionConfig: VersionConfig = DEFAULT_VERSION_CONFIG,
): Promise<void> =>
  Effect.runPromise(
    bootstrapVersionCheck("1.0.0", "file:///x", () => undefined, options).pipe(
      Effect.provide(
        Layer.mergeAll(makeVersionCheckLayer(versionConfig), makeRuntimeLayer(optedOut)),
      ),
    ),
  );

describe("bootstrapVersionCheck upgrade notice", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it.effect("emits the notice (stderr) when a newer version exists and not quiet", () =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => run({ quiet: false }));
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0]?.[0])).toContain("Update available");
    }),
  );

  it.effect("emits the notice when options is omitted (default human behavior)", () =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => run(undefined));
      expect(errorSpy).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect("suppresses the notice when quiet (--json / --non-interactive / CI)", () =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => run({ quiet: true }));
      expect(errorSpy).not.toHaveBeenCalled();
    }),
  );

  it.effect("emits nothing when the user opted out, regardless of quiet", () =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => run({ quiet: false }, true));
      expect(errorSpy).not.toHaveBeenCalled();
    }),
  );

  it.effect("emits the notice on a cold cache via a foreground fetch (first run)", () =>
    Effect.gen(function* () {
      yield* Effect.promise(async () =>
        run({ quiet: false }, false, { cachedLatest: undefined, fetchLatest: "9.9.9" }),
      );
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0]?.[0])).toContain("Update available");
    }),
  );

  it.effect("stays silent when the cold-cache foreground fetch fails (offline)", () =>
    Effect.gen(function* () {
      yield* Effect.promise(async () =>
        run({ quiet: false }, false, { cachedLatest: undefined, fetchLatest: undefined }),
      );
      expect(errorSpy).not.toHaveBeenCalled();
    }),
  );
});
