import { CommandExecutor, FileSystem } from "@effect/platform";
import { it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";

import { FingerprintMismatchError } from "../../lib/exit-codes";
import { FingerprintError } from "../../lib/fingerprint";
import { makeOutputModeLayer } from "../../lib/output-mode";
import { failureError } from "../../lib/test-utils";
import { ApiClientService } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";
import { runCompare } from "./compare";

import type { FingerprintSource } from "../../lib/fingerprint";
import type { ApiClient } from "../../services/api-client";

// ── stubs ─────────────────────────────────────────────────────────

interface StubApiOptions {
  readonly builds?: Record<string, string | null>;
  readonly updates?: Record<string, string | null>;
}

const makeStubApiClient = (options: StubApiOptions): ApiClient =>
  ({
    builds: {
      get: ({ path }: { readonly path: { readonly id: string } }) =>
        Effect.succeed({ id: path.id, fingerprintHash: options.builds?.[path.id] ?? null }),
    },
    updates: {
      get: ({ path }: { readonly path: { readonly id: string } }) =>
        Effect.succeed({ id: path.id, fingerprintHash: options.updates?.[path.id] ?? null }),
    },
  }) as unknown as ApiClient;

const apiLayer = (options: StubApiOptions): Layer.Layer<ApiClientService> =>
  Layer.succeed(ApiClientService, {
    get: Effect.succeed(makeStubApiClient(options)),
    exchangeOneTimeToken: () => Effect.succeed("token"),
  });

const cliRuntimeLayer = (cwd = "/project"): Layer.Layer<CliRuntime> =>
  Layer.succeed(CliRuntime, {
    cwd: Effect.succeed(cwd),
  } as unknown as CliRuntime["Type"]);

const localFingerprint = (hash: string, sources: readonly FingerprintSource[] = []) =>
  JSON.stringify({ hash, sources });

const executorLayer = (stdout: string): Layer.Layer<CommandExecutor.CommandExecutor> =>
  Layer.succeed(CommandExecutor.CommandExecutor, {
    [CommandExecutor.TypeId]: CommandExecutor.TypeId,
    string: () => Effect.succeed(stdout),
  } as unknown as CommandExecutor.CommandExecutor);

// `--platform` routes the local fingerprint through `runFingerprintForPlatform`,
// which probes the filesystem for native markers; a noop FS resolves the
// workflow to "managed" without touching disk.
const fileSystemLayer: Layer.Layer<FileSystem.FileSystem> = Layer.succeed(
  FileSystem.FileSystem,
  FileSystem.makeNoop({}),
);

// The merged stub layer provides every service runCompare requires
// (ApiClientService | CliRuntime | CommandExecutor | FileSystem | OutputMode), so
// providing it collapses the residual requirement to `never` with no cast.
const provide = (options: StubApiOptions, stdout: string) =>
  Effect.provide(
    Layer.mergeAll(
      apiLayer(options),
      cliRuntimeLayer(),
      executorLayer(stdout),
      fileSystemLayer,
      makeOutputModeLayer(false),
    ),
  );

// ── tests ─────────────────────────────────────────────────────────

describe(runCompare, () => {
  it.effect("two build ids with equal hashes -> matched, no error", () =>
    Effect.gen(function* () {
      const result = yield* runCompare({
        "build-id": ["b1", "b2"],
      }).pipe(provide({ builds: { b1: "abc", b2: "abc" } }, localFingerprint("local")));
      expect(result.matched).toBe(true);
      expect(result.side1.hash).toBe("abc");
      expect(result.side2.hash).toBe("abc");
    }),
  );

  it.effect("two build ids with differing hashes -> FingerprintMismatchError (exit 1)", () =>
    Effect.gen(function* () {
      const exit = yield* runCompare({
        "build-id": ["b1", "b2"],
      }).pipe(
        provide({ builds: { b1: "aaa", b2: "bbb" } }, localFingerprint("local")),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(FingerprintMismatchError);
        expect(error!.message).toContain("Source-level diff unavailable");
      }
    }),
  );

  it.effect("build id with a null fingerprint hash -> FingerprintError", () =>
    Effect.gen(function* () {
      const exit = yield* runCompare({
        "build-id": ["b1", "b2"],
      }).pipe(provide({ builds: { b1: null, b2: "bbb" } }, localFingerprint("local")), Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(FingerprintError);
        expect(error!.message).toContain("no recorded fingerprint hash");
      }
    }),
  );

  it.effect("single build id vs local, differing -> mismatch", () =>
    Effect.gen(function* () {
      const exit = yield* runCompare({
        "build-id": "b1",
      }).pipe(provide({ builds: { b1: "server" } }, localFingerprint("local")), Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(failureError(exit)).toBeInstanceOf(FingerprintMismatchError);
      }
    }),
  );

  it.effect("positional hash vs local, matching -> matched", () =>
    Effect.gen(function* () {
      const result = yield* runCompare({
        hash: "same",
      }).pipe(provide({}, localFingerprint("same")));
      expect(result.matched).toBe(true);
    }),
  );

  it.effect("--platform labels the local side and still matches a per-platform hash", () =>
    Effect.gen(function* () {
      // The stub executor returns the same stdout regardless of the per-platform
      // flags, so the local hash matches; the label reflects the platform so the
      // verdict reads like a per-platform comparison.
      const result = yield* runCompare({
        "build-id": "b1",
        platform: "ios",
      }).pipe(provide({ builds: { b1: "ph" } }, localFingerprint("ph")));
      expect(result.matched).toBe(true);
      expect(result.side2.label).toBe("local project (ios)");
    }),
  );

  it.effect("no args -> FingerprintError (nothing to compare)", () =>
    Effect.gen(function* () {
      const exit = yield* runCompare({}).pipe(provide({}, localFingerprint("local")), Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(FingerprintError);
        expect(error!.message).toContain("Nothing to compare");
      }
    }),
  );

  it.effect("more than two ids -> FingerprintError", () =>
    Effect.gen(function* () {
      const exit = yield* runCompare({
        "build-id": ["b1", "b2"],
        "update-id": ["u1"],
      }).pipe(
        provide({ builds: { b1: "a", b2: "b" }, updates: { u1: "c" } }, localFingerprint("l")),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(failureError(exit)).toBeInstanceOf(FingerprintError);
      }
    }),
  );

  it.effect("single id vs local stays hash-level even when the local side exposes sources", () =>
    Effect.gen(function* () {
      // The server side (a build id) never carries sources, so a single-id
      // comparison against a local checkout is hash-level regardless of the
      // local sources. The JSON payload reports that only the local side has
      // sources, and no `diff` is produced.
      const sources: readonly FingerprintSource[] = [
        { type: "contents", id: "expoConfig", reasons: ["expoConfig"], hash: "x" },
      ];
      const result = yield* runCompare({
        "build-id": "b1",
      }).pipe(provide({ builds: { b1: "match" } }, localFingerprint("match", sources)));
      expect(result.matched).toBe(true);
      expect("diff" in result).toBe(false);
      expect(result.side1.hasSources).toBe(false);
      expect(result.side2.hasSources).toBe(true);
    }),
  );
});
