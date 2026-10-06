/**
 * What a built `.app` says about itself — read from the bundle rather than the
 * project, because for a custom build (Tauri, Electron, Flutter) the bundle is
 * the only place the shipped values are known for certain.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { Effect } from "effect";

import { runTool } from "./exec-tool";
import { parsePlist } from "./plist";

export interface MacosAppInfo {
  /** The bundle's file name without `.app` — what users see in Finder. */
  readonly name: string;
  readonly bundleId: string | undefined;
  /** CFBundleShortVersionString. */
  readonly version: string | undefined;
  /** CFBundleVersion. */
  readonly buildNumber: string | undefined;
  /** LSMinimumSystemVersion. */
  readonly minimumSystemVersion: string | undefined;
  /** Slices of the main executable (`lipo -archs`), e.g. `["x86_64", "arm64"]`. */
  readonly architectures: readonly string[];
  /** SUPublicEDKey — the key a Sparkle app checks its updates' signatures with. */
  readonly sparklePublicKey: string | undefined;
}

const stringField = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/** `lipo -archs` prints the slices space-separated on one line. */
export const parseLipoArchs = (output: string): readonly string[] =>
  output.split(/\s+/u).filter((arch) => arch.length > 0);

export const readMacosAppInfo = (appPath: string) =>
  Effect.gen(function* () {
    const info = yield* Effect.promise(async () => {
      try {
        return parsePlist(await readFile(path.join(appPath, "Contents", "Info.plist")));
      } catch {
        return undefined;
      }
    });
    const executable = stringField(info?.["CFBundleExecutable"]);
    const lipo =
      executable === undefined
        ? undefined
        : yield* runTool("lipo", ["-archs", path.join(appPath, "Contents", "MacOS", executable)]);
    return {
      name: path.basename(appPath, ".app"),
      bundleId: stringField(info?.["CFBundleIdentifier"]),
      version: stringField(info?.["CFBundleShortVersionString"]),
      buildNumber: stringField(info?.["CFBundleVersion"]),
      minimumSystemVersion: stringField(info?.["LSMinimumSystemVersion"]),
      architectures: lipo?.exitCode === 0 ? parseLipoArchs(lipo.stdout) : [],
      sparklePublicKey: stringField(info?.["SUPublicEDKey"]),
    } satisfies MacosAppInfo;
  });
