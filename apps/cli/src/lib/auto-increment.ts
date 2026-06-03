import { Console, Effect } from "effect";

import { BuildProfileError } from "./exit-codes";
import { writeExpoConfigPatch } from "./expo-config";

import type { AndroidAutoIncrement, IosAutoIncrement, Platform } from "./build-profile";
import type { ExpoConfig } from "./expo-config";

interface BumpedValues {
  readonly nextBuildNumber?: string;
  readonly nextVersionCode?: number;
  readonly nextVersion?: string;
}

export const bumpBuildNumber = (
  current: string | undefined,
): Effect.Effect<string, BuildProfileError> =>
  Effect.gen(function* () {
    const raw = current ?? "0";
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
      return yield* new BuildProfileError({
        message: `Cannot autoIncrement ios.buildNumber: current value "${raw}" is not a base-10 integer.`,
      });
    }
    return String(parsed + 1);
  });

export const bumpVersionCode = (
  current: number | undefined,
): Effect.Effect<number, BuildProfileError> =>
  Effect.gen(function* () {
    const value = current ?? 0;
    if (!Number.isInteger(value) || value < 0) {
      return yield* new BuildProfileError({
        message: `Cannot autoIncrement android.versionCode: current value ${String(value)} is not a non-negative integer.`,
      });
    }
    return value + 1;
  });

const SEMVER_PATCH = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?<suffix>.*)$/u;

export const bumpVersion = (
  current: string | undefined,
): Effect.Effect<string, BuildProfileError> =>
  Effect.gen(function* () {
    if (current === undefined) {
      return yield* new BuildProfileError({
        message: "Cannot autoIncrement version: no `version` field set in Expo config.",
      });
    }
    const match = SEMVER_PATCH.exec(current);
    if (!match) {
      return yield* new BuildProfileError({
        message: `Cannot autoIncrement version: "${current}" is not a semver string like "1.2.3".`,
      });
    }
    const [, major, minor, patch, suffix] = match;
    const nextPatch = Number.parseInt(patch ?? "0", 10) + 1;
    // eslint-disable-next-line eslint-js/no-restricted-syntax -- regex match groups are typed as `string | undefined` but the pattern guarantees major/minor/patch are captured; suffix is intentionally optional (semver without pre-release)
    return `${major ?? "0"}.${minor ?? "0"}.${String(nextPatch)}${suffix ?? ""}`;
  });

const computeIosBumps = (
  config: ExpoConfig,
  mode: IosAutoIncrement,
): Effect.Effect<BumpedValues, BuildProfileError> =>
  Effect.gen(function* () {
    if (mode === "buildNumber") {
      const next = yield* bumpBuildNumber(config.ios?.buildNumber);
      return { nextBuildNumber: next } as const;
    }
    const nextVersion = yield* bumpVersion(config.version);
    const next = yield* bumpBuildNumber(config.ios?.buildNumber);
    return { nextVersion, nextBuildNumber: next } as const;
  });

const computeAndroidBumps = (
  config: ExpoConfig,
  mode: AndroidAutoIncrement,
): Effect.Effect<BumpedValues, BuildProfileError> =>
  Effect.gen(function* () {
    if (mode === "versionCode") {
      const next = yield* bumpVersionCode(config.android?.versionCode);
      return { nextVersionCode: next } as const;
    }
    const nextVersion = yield* bumpVersion(config.version);
    const next = yield* bumpVersionCode(config.android?.versionCode);
    return { nextVersion, nextVersionCode: next } as const;
  });

const buildPatch = (platform: Platform, bumps: BumpedValues): Record<string, unknown> => {
  const patch: Record<string, unknown> = {};
  if (bumps.nextVersion !== undefined) {
    patch["version"] = bumps.nextVersion;
  }
  if (platform === "ios" && bumps.nextBuildNumber !== undefined) {
    patch["ios"] = { buildNumber: bumps.nextBuildNumber };
  }
  if (platform === "android" && bumps.nextVersionCode !== undefined) {
    patch["android"] = { versionCode: bumps.nextVersionCode };
  }
  return patch;
};

const describeBumps = (platform: Platform, bumps: BumpedValues): string => {
  const parts: string[] = [];
  if (bumps.nextVersion !== undefined) {
    parts.push(`version=${bumps.nextVersion}`);
  }
  if (platform === "ios" && bumps.nextBuildNumber !== undefined) {
    parts.push(`ios.buildNumber=${bumps.nextBuildNumber}`);
  }
  if (platform === "android" && bumps.nextVersionCode !== undefined) {
    parts.push(`android.versionCode=${String(bumps.nextVersionCode)}`);
  }
  return parts.join(", ");
};

export interface ApplyAutoIncrementInput {
  readonly projectRoot: string;
  readonly platform: Platform;
  readonly config: ExpoConfig;
  readonly iosMode?: IosAutoIncrement;
  readonly androidMode?: AndroidAutoIncrement;
}

const computeBumps = (
  input: ApplyAutoIncrementInput,
): Effect.Effect<BumpedValues, BuildProfileError> => {
  if (input.platform === "ios") {
    return input.iosMode === undefined
      ? Effect.succeed({} as const satisfies BumpedValues)
      : computeIosBumps(input.config, input.iosMode);
  }
  return input.androidMode === undefined
    ? Effect.succeed({} as const satisfies BumpedValues)
    : computeAndroidBumps(input.config, input.androidMode);
};

const hasAnyBump = (bumps: BumpedValues): boolean =>
  bumps.nextVersion !== undefined ||
  bumps.nextBuildNumber !== undefined ||
  bumps.nextVersionCode !== undefined;

/**
 * Bump `version` / `ios.buildNumber` / `android.versionCode` per the resolved
 * autoIncrement mode, persist via `@expo/config.modifyConfigAsync`, and log a
 * Human-readable summary. No-op when the mode is undefined. Returns the new
 * Bumped values so callers can refresh their in-memory ExpoConfig.
 */
export const applyAutoIncrement = (
  input: ApplyAutoIncrementInput,
): Effect.Effect<BumpedValues, BuildProfileError> =>
  Effect.gen(function* () {
    const bumps = yield* computeBumps(input);
    if (!hasAnyBump(bumps)) {
      return bumps;
    }
    const patch = buildPatch(input.platform, bumps);
    const result = yield* writeExpoConfigPatch(input.projectRoot, patch).pipe(
      Effect.mapError(
        (cause) =>
          new BuildProfileError({
            message: `Failed to persist autoIncrement: ${cause.message}`,
          }),
      ),
    );
    if (result.type === "warn" && result.configPath === null) {
      yield* Console.log(
        `autoIncrement: dynamic Expo config detected, cannot write back. Update manually: ${describeBumps(input.platform, bumps)}`,
      );
      return bumps;
    }
    yield* Console.log(`autoIncrement: bumped ${describeBumps(input.platform, bumps)}`);
    return bumps;
  });
