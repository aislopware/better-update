import { Buffer } from "node:buffer";
import path from "node:path";

import { asRecord } from "@better-update/type-guards";
import { Command, FileSystem } from "@effect/platform";
import { Data, Effect } from "effect";

import type { CommandExecutor } from "@effect/platform";

import { parsePlist } from "./plist";

export class NativeRunError extends Data.TaggedError("NativeRunError")<{
  readonly message: string;
}> {}

export const execCapture = (
  step: string,
  bin: string,
  ...args: readonly string[]
): Effect.Effect<string, NativeRunError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    const result = yield* Command.string(Command.make(bin, ...args)).pipe(
      Effect.mapError(
        (cause) => new NativeRunError({ message: `${step} failed: ${String(cause)}` }),
      ),
    );
    return result;
  });

const runInherit = (
  step: string,
  bin: string,
  ...args: readonly string[]
): Effect.Effect<void, NativeRunError, CommandExecutor.CommandExecutor> =>
  Command.exitCode(
    Command.make(bin, ...args).pipe(Command.stdout("inherit"), Command.stderr("inherit")),
  ).pipe(
    Effect.mapError(
      (cause) => new NativeRunError({ message: `${step} failed to spawn: ${String(cause)}` }),
    ),
    Effect.flatMap((code) =>
      code === 0
        ? Effect.void
        : Effect.fail(new NativeRunError({ message: `${step} exited with code ${String(code)}` })),
    ),
  );

/**
 * Locate a tool on PATH. Returns the absolute path or fails with NativeRunError.
 */
export const which = (
  bin: string,
): Effect.Effect<string, NativeRunError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    const output = yield* Command.string(Command.make("which", bin)).pipe(
      Effect.mapError(() => new NativeRunError({ message: `${bin} not found in PATH` })),
    );
    const trimmed = output.trim();
    if (trimmed === "") {
      return yield* new NativeRunError({ message: `${bin} not found in PATH` });
    }
    return trimmed;
  });

/**
 * Extract a .tar.gz into destDir using the system `tar` binary.
 */
export const extractTarGz = (
  archive: string,
  destDir: string,
): Effect.Effect<void, NativeRunError, CommandExecutor.CommandExecutor> =>
  runInherit("tar -xzf", "tar", "-xzf", archive, "-C", destDir);

/**
 * Extract a zip-like archive (e.g. .ipa) into destDir.
 */
export const extractZip = (
  archive: string,
  destDir: string,
): Effect.Effect<void, NativeRunError, CommandExecutor.CommandExecutor> =>
  runInherit("unzip", "unzip", "-q", "-o", archive, "-d", destDir);

/**
 * Locate the first `.app` directory under root (recursive, depth ≤ 3).
 */
export const findAppBundle = (
  root: string,
): Effect.Effect<string, NativeRunError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const candidates = [root, path.join(root, "Payload")];
    for (const candidate of candidates) {
      const entries = yield* fs
        .readDirectory(candidate)
        .pipe(Effect.orElseSucceed((): readonly string[] => []));
      const app = entries.find((entry) => entry.endsWith(".app"));
      if (app) {
        return path.join(candidate, app);
      }
    }
    return yield* new NativeRunError({
      message: `No .app bundle found inside ${root} or ${path.join(root, "Payload")}.`,
    });
  });

/**
 * Read CFBundleIdentifier from an .app bundle's Info.plist.
 */
export const readBundleIdFromApp = (
  appDir: string,
): Effect.Effect<string, NativeRunError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const plistPath = path.join(appDir, "Info.plist");
    const data = yield* fs
      .readFile(plistPath)
      .pipe(
        Effect.mapError(
          (cause) => new NativeRunError({ message: `Failed to read Info.plist: ${String(cause)}` }),
        ),
      );
    const parsed = parsePlist(Buffer.from(data));
    const bundleId = parsed["CFBundleIdentifier"];
    if (typeof bundleId !== "string" || bundleId === "") {
      return yield* new NativeRunError({
        message: `Info.plist at ${plistPath} is missing CFBundleIdentifier.`,
      });
    }
    return bundleId;
  });

export interface BootedSimulator {
  readonly udid: string;
  readonly name: string;
}

interface SimctlDevice {
  readonly udid: string;
  readonly name: string;
  readonly state: string;
  readonly isAvailable: boolean;
}

const isSimctlDevice = (value: unknown): value is SimctlDevice => {
  const record = asRecord(value);
  if (!record) {
    return false;
  }
  return (
    typeof record["udid"] === "string" &&
    typeof record["name"] === "string" &&
    typeof record["state"] === "string" &&
    typeof record["isAvailable"] === "boolean"
  );
};

const parseSimctlList = (raw: string): Effect.Effect<readonly SimctlDevice[], NativeRunError> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: (): unknown => JSON.parse(raw),
      catch: () =>
        new NativeRunError({ message: "Failed to parse `simctl list devices --json` output." }),
    });
    const root = asRecord(parsed);
    const devicesField = root ? asRecord(root["devices"]) : undefined;
    if (!devicesField) {
      return [];
    }
    return Object.values(devicesField)
      .filter((group): group is readonly unknown[] => Array.isArray(group))
      .flatMap((group) => group.filter(isSimctlDevice));
  });

/**
 * Pick an iOS simulator: --simulator flag wins (matches name or udid), else the
 * first booted simulator, else fail with a list of bootable choices.
 */
export const pickSimulator = (
  selector: string | undefined,
): Effect.Effect<BootedSimulator, NativeRunError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    const raw = yield* execCapture(
      "xcrun simctl list devices --json",
      "xcrun",
      "simctl",
      "list",
      "devices",
      "--json",
    );
    const devices = yield* parseSimctlList(raw);
    const available = devices.filter((device) => device.isAvailable);

    if (selector !== undefined) {
      const match = available.find(
        (device) => device.udid === selector || device.name === selector,
      );
      if (!match) {
        return yield* new NativeRunError({
          message: `Simulator "${selector}" not found. Run \`xcrun simctl list devices\` to inspect available devices.`,
        });
      }
      return { udid: match.udid, name: match.name };
    }

    const booted = available.find((device) => device.state === "Booted");
    if (booted) {
      return { udid: booted.udid, name: booted.name };
    }

    return yield* new NativeRunError({
      message:
        "No booted simulator found. Pass --simulator <name|udid>, or boot one with `xcrun simctl boot <udid>` and re-run.",
    });
  });

export interface ConnectedAndroidDevice {
  readonly serial: string;
}

/**
 * Pick an Android device or emulator via adb devices.
 */
export const pickAndroidDevice = (
  selector: string | undefined,
): Effect.Effect<ConnectedAndroidDevice, NativeRunError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    const raw = yield* execCapture("adb devices", "adb", "devices");
    const lines = raw
      .split("\n")
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line.endsWith("device"));
    const serials = lines
      .map((line) => line.split(/\s+/u)[0])
      .filter((serial): serial is string => serial !== undefined);

    if (selector !== undefined) {
      const match = serials.find((serial) => serial === selector);
      if (!match) {
        return yield* new NativeRunError({
          message: `Android device "${selector}" not connected. Run \`adb devices\` to inspect available devices.`,
        });
      }
      return { serial: match };
    }

    const [first] = serials;
    if (!first) {
      return yield* new NativeRunError({
        message:
          "No Android device or emulator connected. Start an emulator or attach a device, then re-run.",
      });
    }
    return { serial: first };
  });

export const installAndLaunchIosSimulator = (params: {
  readonly udid: string;
  readonly appDir: string;
  readonly bundleId: string;
}): Effect.Effect<void, NativeRunError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    yield* runInherit(
      `xcrun simctl install ${params.udid}`,
      "xcrun",
      "simctl",
      "install",
      params.udid,
      params.appDir,
    );
    yield* runInherit(
      `xcrun simctl launch ${params.udid} ${params.bundleId}`,
      "xcrun",
      "simctl",
      "launch",
      params.udid,
      params.bundleId,
    );
  });

export const installAndLaunchIosDevice = (params: {
  readonly udid: string;
  readonly ipaPath: string;
  readonly bundleId: string;
}): Effect.Effect<void, NativeRunError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    yield* runInherit(
      `xcrun devicectl device install app --device ${params.udid}`,
      "xcrun",
      "devicectl",
      "device",
      "install",
      "app",
      "--device",
      params.udid,
      params.ipaPath,
    );
    yield* runInherit(
      `xcrun devicectl device process launch --device ${params.udid} ${params.bundleId}`,
      "xcrun",
      "devicectl",
      "device",
      "process",
      "launch",
      "--device",
      params.udid,
      params.bundleId,
    );
  });

/**
 * Read the Android package name from an APK via aapt or aapt2. Returns
 * undefined if neither tool is on PATH or extraction fails — callers should
 * fall back to a CLI flag.
 */
const tryReadApkPackageWith = (
  bin: string,
  apkPath: string,
): Effect.Effect<string | undefined, never, CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    const located = yield* which(bin).pipe(Effect.orElseSucceed((): string | null => null));
    if (!located) {
      return undefined;
    }
    const raw = yield* execCapture(`${bin} dump`, bin, "dump", "badging", apkPath).pipe(
      Effect.orElseSucceed((): string | null => null),
    );
    if (!raw) {
      return undefined;
    }
    const match = /package: name='(?<packageName>[^']+)'/u.exec(raw);
    return match?.[1];
  });

export const readApkPackageName = (
  apkPath: string,
): Effect.Effect<string | undefined, never, CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    const candidates = ["aapt2", "aapt"] as const;
    return yield* Effect.reduce(candidates, undefined as string | undefined, (acc, bin) =>
      acc === undefined ? tryReadApkPackageWith(bin, apkPath) : Effect.succeed(acc),
    );
  });

export const installAndLaunchAndroid = (params: {
  readonly serial: string;
  readonly apkPath: string;
  readonly packageName: string;
}): Effect.Effect<void, NativeRunError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    yield* runInherit(
      `adb -s ${params.serial} install`,
      "adb",
      "-s",
      params.serial,
      "install",
      "-r",
      params.apkPath,
    );
    yield* runInherit(
      `adb -s ${params.serial} monkey ${params.packageName}`,
      "adb",
      "-s",
      params.serial,
      "shell",
      "monkey",
      "-p",
      params.packageName,
      "-c",
      "android.intent.category.LAUNCHER",
      "1",
    );
  });
