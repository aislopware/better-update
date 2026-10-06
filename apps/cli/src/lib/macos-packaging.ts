/**
 * Distribution containers for a signed macOS `.app`: a drag-to-install DMG, a
 * zip (what Sparkle / Squirrel.Mac updaters consume), a flat installer pkg, or
 * the `.app.tar.gz` the Tauri updater installs.
 * Choices here follow what was measured, not folklore: UDZO + HFS+ because the
 * lzfse/lzma formats save ~4 % on a real app while dropping older macOS, and
 * the DMG is signed with the Developer ID *Application* identity (installer
 * identities only sign pkgs) under an explicit identifier — without `-i`,
 * codesign derives one from the file name (`App-1.2.dmg` → `App-1`).
 */
import { mkdir, symlink } from "node:fs/promises";
import path from "node:path";

import { Effect } from "effect";

import { execFailureDetail, runTool } from "./exec-tool";
import { CodesignError } from "./exit-codes";

export type MacosPackageFormat = "dmg" | "zip" | "pkg" | "tar.gz";

const runOrFail = (bin: string, args: readonly string[], step: string) =>
  Effect.gen(function* () {
    const result = yield* runTool(bin, args);
    if (result.exitCode !== 0) {
      return yield* new CodesignError({
        message: `${step} failed: ${execFailureDetail(result)}`,
      });
    }
    return result;
  });

/**
 * `ditto -c -k --sequesterRsrc --keepParent`: the archive form that keeps
 * symlinks, extended attributes, and the stapled ticket intact — what both
 * notarytool and the Sparkle / Squirrel updaters expect.
 */
export const zipApp = (appPath: string, outputPath: string) =>
  runOrFail(
    "ditto",
    ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, outputPath],
    "ditto (zip)",
  ).pipe(Effect.asVoid);

/**
 * The archive the Tauri updater unpacks: the `.app` as the top-level entry
 * (the updater drops the first path component and moves the rest into place).
 * `COPYFILE_DISABLE` + `--no-mac-metadata` keep macOS's `._` AppleDouble
 * entries out — they would land inside the installed bundle and break its seal.
 */
export const tarApp = (appPath: string, outputPath: string) =>
  Effect.gen(function* () {
    const result = yield* runTool(
      "tar",
      [
        "--no-mac-metadata",
        "-czf",
        outputPath,
        "-C",
        path.dirname(appPath),
        path.basename(appPath),
      ],
      { COPYFILE_DISABLE: "1" },
    );
    if (result.exitCode !== 0) {
      return yield* new CodesignError({ message: `tar failed: ${execFailureDetail(result)}` });
    }
  });

export interface CreateDmgOptions {
  readonly appPath: string;
  readonly outputPath: string;
  readonly volumeName: string;
  /** Scratch dir for the staging folder (the app copy + Applications link). */
  readonly workDir: string;
  /** Developer ID Application identity (name or SHA-1) and its keychain. */
  readonly identity: string;
  readonly keychainPath: string;
  /** Signing identifier for the image, e.g. `com.example.app.dmg`. */
  readonly identifier: string;
}

/**
 * Build a compressed, signed DMG holding the app next to an `/Applications`
 * link. `hdiutil` is deprecated on macOS 27 but remains the only tool that can
 * write HFS+ images, and it prints a warning line — its output is never parsed.
 */
export const createSignedDmg = (options: CreateDmgOptions) =>
  Effect.gen(function* () {
    const stage = path.join(options.workDir, "dmg-stage");
    yield* Effect.promise(async () => mkdir(stage, { recursive: true }));
    yield* runOrFail(
      "ditto",
      [options.appPath, path.join(stage, path.basename(options.appPath))],
      "ditto (stage)",
    );
    yield* Effect.promise(async () => symlink("/Applications", path.join(stage, "Applications")));
    yield* runOrFail(
      "hdiutil",
      [
        "create",
        "-quiet",
        "-volname",
        options.volumeName,
        "-srcfolder",
        stage,
        "-fs",
        "HFS+",
        "-format",
        "UDZO",
        "-ov",
        options.outputPath,
      ],
      "hdiutil create",
    );
    yield* runOrFail(
      "codesign",
      [
        "--force",
        "--timestamp",
        "--identifier",
        options.identifier,
        "--sign",
        options.identity,
        "--keychain",
        options.keychainPath,
        options.outputPath,
      ],
      "codesign (dmg)",
    );
    yield* runOrFail(
      "codesign",
      ["--verify", "--strict", options.outputPath],
      "codesign --verify (dmg)",
    );
  });

export interface CreatePkgOptions {
  readonly appPath: string;
  readonly outputPath: string;
  /** Developer ID Installer identity (name or SHA-1) and its keychain. */
  readonly installerIdentity: string;
  readonly keychainPath: string;
}

/**
 * Flat product archive installing the app into `/Applications`, signed with a
 * Developer ID Installer identity (`productbuild` timestamps Developer ID
 * signatures by default; `--timestamp` makes it explicit). Verified with
 * `pkgutil --check-signature`.
 */
export const createSignedPkg = (options: CreatePkgOptions) =>
  Effect.gen(function* () {
    yield* runOrFail(
      "productbuild",
      [
        "--component",
        options.appPath,
        "/Applications",
        "--sign",
        options.installerIdentity,
        "--keychain",
        options.keychainPath,
        "--timestamp",
        options.outputPath,
      ],
      "productbuild",
    );
    yield* runOrFail(
      "pkgutil",
      ["--check-signature", options.outputPath],
      "pkgutil --check-signature",
    );
  });
