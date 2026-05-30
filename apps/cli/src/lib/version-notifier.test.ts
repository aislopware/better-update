import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { CliRuntime } from "../services/cli-runtime";
import { VersionCheck } from "../services/version-check";
import { bootstrapVersionCheck } from "./version-notifier";

// A newer cached version is available + the cache is fresh, so the only variable
// across these tests is whether the upgrade notice is emitted. The notice goes
// to stderr (Console.error), never stdout, so it cannot corrupt the JSON
// envelope — but EAS suppresses it under --json/CI and so do we (P4).

const makeVersionCheckLayer = () =>
  Layer.succeed(VersionCheck, {
    cachedLatest: Effect.succeed("9.9.9"),
    cacheStale: Effect.succeed(false),
    refreshCache: Effect.void,
  });

const makeRuntimeLayer = (optedOut: boolean) =>
  Layer.succeed(CliRuntime, {
    argv: [],
    platform: "darwin" as NodeJS.Platform,
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
): Promise<void> =>
  Effect.runPromise(
    bootstrapVersionCheck("1.0.0", "file:///x", () => undefined, options).pipe(
      Effect.provide(Layer.mergeAll(makeVersionCheckLayer(), makeRuntimeLayer(optedOut))),
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
});
