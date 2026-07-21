/**
 * Developer ID code-signing for a macOS `.app` bundle: discover every nested
 * code item (frameworks, helper apps, XPC services, dylibs, extra Mach-O
 * executables), sign them inside-out with the hardened runtime + a secure
 * timestamp (both required by notarization), then sign and verify the outer
 * bundle. This is the walk `codesign --deep` used to approximate — done
 * explicitly because `--deep` is deprecated and misses loose Mach-Os.
 */
import { open, readdir } from "node:fs/promises";
import path from "node:path";

import { Effect } from "effect";

import { execFailureDetail, runTool } from "./exec-tool";
import { CodesignError } from "./exit-codes";

// ── discovery ─────────────────────────────────────────────────────

/** Bundle-shaped directories codesign treats as one nested code unit. */
const NESTED_BUNDLE_EXTENSIONS = [".framework", ".app", ".xpc", ".appex", ".bundle", ".plugin"];

/** Loose files that are always code, regardless of exec bit. */
const CODE_FILE_EXTENSIONS = [".dylib", ".so", ".node"];

const hasExtension = (name: string, extensions: readonly string[]): boolean => {
  const lower = name.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
};

// Mach-O magics as hex strings (oxfmt/unicorn disagree on numeric hex-literal
// case): 32/64-bit thin binaries (both byte orders) and fat binaries (both
// byte orders).
const MACHO_MAGICS: ReadonlySet<string> = new Set([
  "feedface",
  "feedfacf",
  "cefaedfe",
  "cffaedfe",
  "cafebabe",
  "bebafeca",
]);

/**
 * Whether the file starts with a Mach-O (thin or fat) magic. Filters exec-bit
 * shell scripts and data files out of the signing list — signing those would
 * churn resources for no gain and can break scripts that self-inspect.
 */
const isMachO = (filePath: string) =>
  Effect.promise(async () => {
    const handle = await open(filePath, "r");
    try {
      const buffer = Buffer.alloc(4);
      const { bytesRead } = await handle.read(buffer, 0, 4, 0);
      return bytesRead >= 4 && MACHO_MAGICS.has(buffer.toString("hex"));
    } finally {
      await handle.close();
    }
  });

const listEntries = (dirPath: string) =>
  Effect.promise(async () => readdir(dirPath, { withFileTypes: true }));

/**
 * Recursively collect nested code inside `appPath`: bundle directories and
 * loose Mach-O files. Symlinks are never followed (framework `Versions/Current`
 * links would double-visit), and the outer bundle itself is NOT in the result —
 * the caller signs it last with the entitlements.
 */
export const collectNestedCode = (appPath: string): Effect.Effect<readonly string[]> => {
  const walk = (dirPath: string): Effect.Effect<readonly string[]> =>
    Effect.gen(function* () {
      const entries = yield* listEntries(dirPath);
      const collected = yield* Effect.all(
        entries.map((entry) =>
          Effect.gen(function* () {
            if (entry.isSymbolicLink()) {
              return [] as readonly string[];
            }
            const entryPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
              // Descend even into bundle dirs: frameworks carry loose dylibs of
              // their own that need individual signatures underneath the
              // framework's.
              const own = hasExtension(entry.name, NESTED_BUNDLE_EXTENSIONS) ? [entryPath] : [];
              return [...own, ...(yield* walk(entryPath))];
            }
            if (!entry.isFile()) {
              return [];
            }
            const looksLikeCode =
              hasExtension(entry.name, CODE_FILE_EXTENSIONS) || (yield* isMachO(entryPath));
            return looksLikeCode ? [entryPath] : [];
          }),
        ),
      );
      return collected.flat();
    });
  return walk(appPath);
};

/**
 * Inside-out signing order: deepest paths first so every nested item is sealed
 * before the code that contains it. Ties break lexicographically for
 * determinism. The outer bundle is appended by the caller, never here.
 */
export const orderForSigning = (paths: readonly string[]): readonly string[] =>
  [...paths].toSorted((left, right) => {
    const depthLeft = left.split(path.sep).length;
    const depthRight = right.split(path.sep).length;
    return depthRight === depthLeft ? left.localeCompare(right) : depthRight - depthLeft;
  });

/**
 * The main executable (and anything else directly under `Contents/MacOS`) is
 * sealed by the outer-bundle signature, so signing it standalone first would be
 * immediately overwritten by the final `--force` pass. Everything else nested
 * keeps its own signature.
 */
export const isSealedByOuterSignature = (appPath: string, itemPath: string): boolean =>
  path.dirname(itemPath) === path.join(appPath, "Contents", "MacOS");

// ── signing ───────────────────────────────────────────────────────

export interface SignMacosAppOptions {
  readonly appPath: string;
  /** Keychain identity string, e.g. `Developer ID Application: Acme (TEAMID)`. */
  readonly identity: string;
  /** Ephemeral keychain holding the imported `.p12` (from acquireKeychain). */
  readonly keychainPath: string;
  /** Entitlements plist applied to the OUTER bundle only. */
  readonly entitlementsPath?: string | undefined;
}

const codesignArgs = (
  options: SignMacosAppOptions,
  target: string,
  withEntitlements: boolean,
): readonly string[] => [
  "--force",
  "--timestamp",
  "--options",
  "runtime",
  "--sign",
  options.identity,
  "--keychain",
  options.keychainPath,
  ...(withEntitlements && options.entitlementsPath !== undefined
    ? ["--entitlements", options.entitlementsPath]
    : []),
  target,
];

const codesignOrFail = (args: readonly string[], target: string) =>
  Effect.gen(function* () {
    const result = yield* runTool("codesign", args);
    if (result.exitCode !== 0) {
      return yield* new CodesignError({
        message: `codesign failed for ${target}: ${execFailureDetail(result)}`,
      });
    }
    return undefined;
  });

export interface SignMacosAppResult {
  /** Nested items that received their own signature, inside-out order. */
  readonly signedNested: readonly string[];
}

/**
 * Sign a single Mach-O (a bare CLI tool / helper binary outside a bundle) and
 * verify it. Entitlements apply directly to the file.
 */
export const signMacosFile = (options: SignMacosAppOptions) =>
  Effect.gen(function* () {
    yield* codesignOrFail(codesignArgs(options, options.appPath, true), options.appPath);
    const verify = yield* runTool("codesign", ["--verify", "--strict", options.appPath]);
    if (verify.exitCode !== 0) {
      return yield* new CodesignError({
        message: `Signature verification failed: ${execFailureDetail(verify)}`,
      });
    }
    return { signedNested: [] } satisfies SignMacosAppResult;
  });

/**
 * Sign the whole bundle inside-out with the hardened runtime and a secure
 * timestamp, then verify with `codesign --verify --deep --strict`. Fails with
 * {@link CodesignError} carrying the first failing target's codesign output.
 */
export const signMacosApp = (options: SignMacosAppOptions) =>
  Effect.gen(function* () {
    const nested = yield* collectNestedCode(options.appPath);
    const ordered = orderForSigning(
      nested.filter((item) => !isSealedByOuterSignature(options.appPath, item)),
    );
    yield* Effect.forEach(
      ordered,
      (target) => codesignOrFail(codesignArgs(options, target, false), target),
      { discard: true },
    );
    yield* codesignOrFail(codesignArgs(options, options.appPath, true), options.appPath);

    const verify = yield* runTool("codesign", [
      "--verify",
      "--deep",
      "--strict",
      "--verbose=2",
      options.appPath,
    ]);
    if (verify.exitCode !== 0) {
      return yield* new CodesignError({
        message: `Signature verification failed: ${execFailureDetail(verify)}`,
      });
    }
    return { signedNested: ordered } satisfies SignMacosAppResult;
  });
