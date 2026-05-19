import path from "node:path";

import { asRecord } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { printWarn } from "./warning-style";

import type { OutputMode } from "./output-mode";

interface PackageJsonDeps {
  readonly dependencies?: Record<string, unknown>;
  readonly devDependencies?: Record<string, unknown>;
}

const readDeps = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    // Sink any read error (file missing, permission denied) into `undefined`
    // and treat it as "no dev-client info" — the only caller is a warning
    // emitter that should never fail the build over its own probe.
    const text = yield* fs.readFileString(filePath).pipe(
      Effect.option,
      Effect.catchAllDefect(() => Effect.succeedNone),
    );
    if (text._tag === "None") {
      return undefined;
    }
    const parsed = yield* Effect.try({
      try: (): unknown => JSON.parse(text.value),
      catch: () => undefined,
    }).pipe(Effect.option);
    if (parsed._tag === "None") {
      return undefined;
    }
    const root = asRecord(parsed.value);
    if (!root) {
      return undefined;
    }
    const dependencies = asRecord(root["dependencies"]);
    const devDependencies = asRecord(root["devDependencies"]);
    return {
      ...(dependencies === undefined ? {} : { dependencies }),
      ...(devDependencies === undefined ? {} : { devDependencies }),
    } satisfies PackageJsonDeps;
  });

const hasExpoDevClient = (deps: PackageJsonDeps | undefined): boolean => {
  if (!deps) {
    return false;
  }
  return (
    Object.hasOwn(deps.dependencies ?? {}, "expo-dev-client") ||
    Object.hasOwn(deps.devDependencies ?? {}, "expo-dev-client")
  );
};

/**
 * Read `<projectRoot>/package.json` and report whether `expo-dev-client` is
 * declared (either in `dependencies` or `devDependencies`). Returns `false`
 * when the file is missing or unparseable — callers treat that as "not
 * installed". Does not walk monorepo workspaces: `expo-dev-client` is an
 * app-level dep in every Expo template and root-hoisting native deps is
 * unusual.
 */
export const hasDevClientInstalled = (
  projectRoot: string,
): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const pkgPath = path.join(projectRoot, "package.json");
    const deps = yield* readDeps(pkgPath).pipe(Effect.orElseSucceed(() => undefined));
    return hasExpoDevClient(deps);
  });

/**
 * Verify `expo-dev-client` is installed when the profile sets
 * `developmentClient: true`. Without it the built binary boots straight into
 * the regular app (no launcher, no Metro switcher) and the user cannot connect
 * a dev server. EAS warns and proceeds; we mirror that — warn, do not block.
 */
export const warnIfDevClientMissing = (
  projectRoot: string,
): Effect.Effect<void, never, FileSystem.FileSystem | OutputMode> =>
  Effect.gen(function* () {
    if (yield* hasDevClientInstalled(projectRoot)) {
      return;
    }
    yield* printWarn(
      "expo-dev-client is not in dependencies. The built artifact will boot the regular app without a Metro launcher. Install it with `bunx expo install expo-dev-client` and rebuild.",
    );
  });
