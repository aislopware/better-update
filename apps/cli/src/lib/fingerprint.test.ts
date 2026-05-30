import { CommandExecutor, FileSystem } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import {
  diffFingerprintSources,
  fingerprintCliArgs,
  resolveExpoWorkflow,
  runFingerprintFull,
} from "./fingerprint";

import type { FingerprintSource } from "./fingerprint";

// ── helpers ───────────────────────────────────────────────────────

const fileSource = (filePath: string, hash: string | null): FingerprintSource => ({
  type: "file",
  filePath,
  reasons: [`bareNativeDir:${filePath}`],
  hash,
});

const contentsSource = (id: string, hash: string | null): FingerprintSource => ({
  type: "contents",
  id,
  reasons: [id],
  hash,
});

const byOp = (
  diff: readonly { readonly op: string; readonly sourceId: string }[],
): Record<string, string[]> =>
  diff.reduce<Record<string, string[]>>((acc, item) => {
    (acc[item.op] ??= []).push(item.sourceId);
    return acc;
  }, {});

const makeStubExecutor = (stdout: string): CommandExecutor.CommandExecutor =>
  ({
    [CommandExecutor.TypeId]: CommandExecutor.TypeId,
    string: () => Effect.succeed(stdout),
  }) as unknown as CommandExecutor.CommandExecutor;

const provideStubExecutor = (stdout: string) =>
  Effect.provideService(CommandExecutor.CommandExecutor, makeStubExecutor(stdout));

// ── diffFingerprintSources ────────────────────────────────────────

describe(diffFingerprintSources, () => {
  it("returns an empty diff for identical source arrays", () => {
    const sources = [fileSource("ios/Podfile", "h1"), contentsSource("expoConfig", "h2")];
    expect(diffFingerprintSources(sources, sources)).toStrictEqual([]);
  });

  it("classifies added / removed / modified sources", () => {
    const before = [fileSource("ios/Podfile", "h1"), contentsSource("expoConfig", "cfg-1")];
    // ios/Podfile unchanged, expoConfig modified (cfg-1 -> cfg-2),
    // android/build.gradle added.
    const after = [
      fileSource("ios/Podfile", "h1"),
      contentsSource("expoConfig", "cfg-2"),
      fileSource("android/build.gradle", "g1"),
    ];

    const diff = diffFingerprintSources(before, after);
    expect(byOp(diff)).toStrictEqual({
      added: ["android/build.gradle"],
      modified: ["expoConfig"],
    });
  });

  it("treats a source only in `before` as removed", () => {
    const diff = diffFingerprintSources([fileSource("ios/Podfile", "h1")], []);
    expect(diff).toStrictEqual([
      {
        op: "removed",
        sourceId: "ios/Podfile",
        type: "file",
        reasons: ["bareNativeDir:ios/Podfile"],
        hashBefore: "h1",
      },
    ]);
  });

  it("carries hashBefore and hashAfter on a modified source", () => {
    const diff = diffFingerprintSources(
      [contentsSource("expoConfig", "old")],
      [contentsSource("expoConfig", "new")],
    );
    expect(diff).toStrictEqual([
      {
        op: "modified",
        sourceId: "expoConfig",
        type: "contents",
        reasons: ["expoConfig"],
        hashBefore: "old",
        hashAfter: "new",
      },
    ]);
  });

  it("is order-independent (shuffled inputs yield the same result set)", () => {
    const before = [fileSource("a", "1"), contentsSource("expoConfig", "x"), fileSource("b", "2")];
    // file "a" modified (1 -> 9), packageJson:scripts added, expoConfig removed.
    const after = [
      fileSource("b", "2"),
      fileSource("a", "9"),
      contentsSource("packageJson:scripts", "y"),
    ];

    const ordered = diffFingerprintSources(before, after);
    const shuffled = diffFingerprintSources(before.toReversed(), after.toReversed());
    expect(shuffled).toStrictEqual(ordered);
    expect(byOp(ordered)).toStrictEqual({
      modified: ["a"],
      removed: ["expoConfig"],
      added: ["packageJson:scripts"],
    });
  });

  it("keys file/dir by filePath and contents by id", () => {
    // A file source and a contents source sharing a value must NOT collide:
    // they key off different fields (filePath vs id).
    const before = [fileSource("shared", "f1"), contentsSource("shared", "c1")];
    const after = [fileSource("shared", "f2"), contentsSource("shared", "c1")];
    const diff = diffFingerprintSources(before, after);
    expect(diff).toStrictEqual([
      {
        op: "modified",
        sourceId: "shared",
        type: "file",
        reasons: ["bareNativeDir:shared"],
        hashBefore: "f1",
        hashAfter: "f2",
      },
    ]);
  });

  it("prefers overrideHashKey over filePath when keying", () => {
    const before: FingerprintSource[] = [
      { type: "file", filePath: "ios/Pods", overrideHashKey: "pods", reasons: [], hash: "p1" },
    ];
    const after: FingerprintSource[] = [
      { type: "file", filePath: "ios/Pods", overrideHashKey: "pods", reasons: [], hash: "p2" },
    ];
    const diff = diffFingerprintSources(before, after);
    expect(diff[0]?.sourceId).toBe("pods");
    expect(diff[0]?.op).toBe("modified");
  });
});

// ── runFingerprintFull determinism ────────────────────────────────

describe(runFingerprintFull, () => {
  it.effect("parses hash + sources deterministically for fixed stdout", () =>
    Effect.gen(function* () {
      const stdout = JSON.stringify({
        hash: "deadbeef",
        sources: [
          { type: "file", filePath: "ios/Podfile", reasons: ["bareNativeDir"], hash: "h1" },
          { type: "contents", id: "expoConfig", reasons: ["expoConfig"], hash: "h2" },
        ],
      });
      const first = yield* runFingerprintFull(".").pipe(provideStubExecutor(stdout));
      const second = yield* runFingerprintFull(".").pipe(provideStubExecutor(stdout));
      expect(first.hash).toBe("deadbeef");
      expect(first).toStrictEqual(second);
      expect(first.sources).toHaveLength(2);
    }),
  );
});

// ── fingerprintCliArgs (EAS per-platform + managed ignorePaths parity) ──

describe(fingerprintCliArgs, () => {
  it("omits --platform when no platform is given (combined hash)", () => {
    expect(fingerprintCliArgs("/proj", {})).toStrictEqual([
      "@expo/fingerprint",
      "fingerprint:generate",
      "/proj",
    ]);
  });

  it("threads --platform for a generic (bare) project, no ignore paths", () => {
    expect(fingerprintCliArgs("/proj", { platform: "ios", workflow: "generic" })).toStrictEqual([
      "@expo/fingerprint",
      "fingerprint:generate",
      "/proj",
      "--platform",
      "ios",
    ]);
  });

  it("adds native-dir --ignore-path filters for a managed project (EAS parity)", () => {
    expect(fingerprintCliArgs("/proj", { platform: "android", workflow: "managed" })).toStrictEqual(
      [
        "@expo/fingerprint",
        "fingerprint:generate",
        "/proj",
        "--platform",
        "android",
        "--ignore-path",
        "android/**/*",
        "--ignore-path",
        "ios/**/*",
      ],
    );
  });

  it("does not add ignore paths without a platform even if workflow is managed", () => {
    expect(fingerprintCliArgs("/proj", { workflow: "managed" })).toStrictEqual([
      "@expo/fingerprint",
      "fingerprint:generate",
      "/proj",
    ]);
  });
});

// ── resolveExpoWorkflow ────────────────────────────────────────────

const notFound = (path: string): SystemError =>
  new SystemError({
    module: "FileSystem",
    method: "stat",
    reason: "NotFound",
    pathOrDescriptor: path,
  });

const makeWorkflowFs = (opts: {
  readonly existing?: readonly string[];
  readonly dirs?: Record<string, readonly string[]>;
}): FileSystem.FileSystem =>
  FileSystem.makeNoop({
    exists: (path) => Effect.succeed((opts.existing ?? []).includes(path)),
    readDirectory: (path) => {
      const entries = opts.dirs?.[path];
      return entries === undefined ? Effect.fail(notFound(path)) : Effect.succeed([...entries]);
    },
  });

const provideWorkflowFs = (fs: FileSystem.FileSystem) =>
  Effect.provideService(FileSystem.FileSystem, fs);

describe(resolveExpoWorkflow, () => {
  it.effect("android: build.gradle present -> generic", () =>
    Effect.gen(function* () {
      const result = yield* resolveExpoWorkflow("/proj", "android").pipe(
        provideWorkflowFs(makeWorkflowFs({ existing: ["/proj/android/app/build.gradle"] })),
      );
      expect(result).toBe("generic");
    }),
  );

  it.effect("android: build.gradle absent -> managed", () =>
    Effect.gen(function* () {
      const result = yield* resolveExpoWorkflow("/proj", "android").pipe(
        provideWorkflowFs(makeWorkflowFs({ existing: [] })),
      );
      expect(result).toBe("managed");
    }),
  );

  it.effect("ios: ios/ dir with an .xcodeproj -> generic", () =>
    Effect.gen(function* () {
      const result = yield* resolveExpoWorkflow("/proj", "ios").pipe(
        provideWorkflowFs(
          makeWorkflowFs({ dirs: { "/proj/ios": ["MyApp.xcodeproj", "Podfile"] } }),
        ),
      );
      expect(result).toBe("generic");
    }),
  );

  it.effect("ios: no ios/ dir -> managed", () =>
    Effect.gen(function* () {
      const result = yield* resolveExpoWorkflow("/proj", "ios").pipe(
        provideWorkflowFs(makeWorkflowFs({})),
      );
      expect(result).toBe("managed");
    }),
  );

  it.effect("ios: ios/ dir without an .xcodeproj -> managed", () =>
    Effect.gen(function* () {
      const result = yield* resolveExpoWorkflow("/proj", "ios").pipe(
        provideWorkflowFs(makeWorkflowFs({ dirs: { "/proj/ios": ["README.md"] } })),
      );
      expect(result).toBe("managed");
    }),
  );
});
