/**
 * Reach the `.app` inside an already-packaged container, so a DMG, zip or pkg
 * a custom build produced (electron-builder, Tauri's bundler) gets the same
 * pre-flight audit and metadata read as an `.app` the CLI packages itself.
 *
 * - dmg — attached read-only and without Finder for the enclosing scope, so
 *   the audit reads the shipped bytes in place.
 * - zip — unpacked with `ditto`, which keeps the symlinks a signature seals.
 * - tar.gz — unpacked with `tar`, as the Tauri updater does.
 * - pkg — `pkgutil --expand-full` unpacks every component's payload.
 */
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

import { Effect } from "effect";

import { execFailureDetail, runTool } from "./exec-tool";
import { CodesignError } from "./exit-codes";

import type { ExecResult } from "./altool";
import type { MacosPackageFormat } from "./macos-packaging";

const failOn = (step: string) => (result: ExecResult) =>
  result.exitCode === 0
    ? Effect.void
    : Effect.fail(new CodesignError({ message: `${step} failed: ${execFailureDetail(result)}` }));

/** First `.app` found walking down from `root`, never descending into one. */
const findShallowestApp = (root: string, depthLeft = 4): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    const entries = yield* Effect.promise(async () =>
      readdir(root, { withFileTypes: true }).catch(() => []),
    );
    const dirs = entries.filter((entry) => entry.isDirectory());
    const app = dirs.find((entry) => entry.name.endsWith(".app"));
    if (app !== undefined) {
      return path.join(root, app.name);
    }
    if (depthLeft === 0) {
      return undefined;
    }
    return yield* Effect.reduce(
      dirs,
      (): string | undefined => undefined,
      (found, entry) =>
        found === undefined
          ? findShallowestApp(path.join(root, entry.name), depthLeft - 1)
          : Effect.succeed(found),
    );
  });

const mountDmg = (dmgPath: string, mountPoint: string) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      yield* Effect.promise(async () => mkdir(mountPoint, { recursive: true }));
      const attached = yield* runTool("hdiutil", [
        "attach",
        "-nobrowse",
        "-readonly",
        "-noautoopen",
        "-mountpoint",
        mountPoint,
        dmgPath,
      ]);
      yield* failOn("hdiutil attach")(attached);
    }),
    () => runTool("hdiutil", ["detach", mountPoint, "-force"]).pipe(Effect.asVoid),
  );

/**
 * Locate the `.app` inside `containerPath`, valid for the enclosing scope.
 * Fails when the container holds no app — there is nothing to audit or ship.
 */
export const openAppInContainer = (params: {
  readonly containerPath: string;
  readonly format: MacosPackageFormat;
  /** Private scratch dir for the mount point / unpacked payload. */
  readonly workDir: string;
}) =>
  Effect.gen(function* () {
    const root = path.join(params.workDir, `open-${params.format}`);
    if (params.format === "dmg") {
      yield* mountDmg(params.containerPath, root);
    } else if (params.format === "zip") {
      yield* Effect.promise(async () => mkdir(root, { recursive: true }));
      yield* runTool("ditto", ["-x", "-k", params.containerPath, root]).pipe(
        Effect.flatMap(failOn("ditto -x")),
      );
    } else if (params.format === "tar.gz") {
      yield* Effect.promise(async () => mkdir(root, { recursive: true }));
      yield* runTool("tar", ["-xzf", params.containerPath, "-C", root]).pipe(
        Effect.flatMap(failOn("tar -xzf")),
      );
    } else {
      // --expand-full refuses an existing destination.
      yield* runTool("pkgutil", ["--expand-full", params.containerPath, root]).pipe(
        Effect.flatMap(failOn("pkgutil --expand-full")),
      );
    }
    const appPath = yield* findShallowestApp(root);
    if (appPath === undefined) {
      return yield* new CodesignError({
        message: `No .app inside ${path.basename(params.containerPath)}.`,
      });
    }
    return appPath;
  });

/**
 * `stapler validate` — whether a container already carries an accepted ticket,
 * so a tool that notarized on its own is not submitted a second time.
 */
export const hasStapledTicket = (artifactPath: string) =>
  runTool("xcrun", ["stapler", "validate", artifactPath]).pipe(
    Effect.map((result) => result.exitCode === 0),
  );
