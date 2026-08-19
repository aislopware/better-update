import { Effect } from "effect";

import { hasAnyExpoConfigFile } from "./detect-project-type";
import { readExpoConfig } from "./expo-config";
import { formatCause } from "./format-error";
import { resolveRuntimeVersion } from "./runtime-version";
import { isExpoUpdatesInstalled } from "./update-channel-native";
import { printWarn } from "./warning-style";

import type { ResolveRuntimeVersionOptions } from "./runtime-version";

/**
 * Whether a non-Expo project should be asked for OTA metadata via its Expo
 * config.
 *
 * Two conditions, and BOTH are load-bearing:
 *
 *  - an Expo config file exists — otherwise there is nothing to read;
 *  - `expo-updates` is a dependency — otherwise the project does not do OTA at
 *    all, so the config has no OTA answer to give.
 *
 * The second condition is what keeps this quiet. The plain React Native
 * template ships an `app.json` (`{ name, displayName }`, no `expo` key), so
 * gating on the file alone would drag every native project through
 * `@expo/config` — paying for the read, and warning at them when a config that
 * was never an Expo config fails to parse. `expo-updates` is the same signal
 * `resolveUpdateChannel` already gates on, so build and upload agree on what
 * "this project does OTA" means.
 */
export const wantsOtaExpoConfig = (projectRoot: string) =>
  Effect.gen(function* () {
    if (!(yield* hasAnyExpoConfigFile(projectRoot))) {
      return false;
    }
    return yield* isExpoUpdatesInstalled(projectRoot);
  });

/**
 * Best-effort Expo config read for OTA metadata on a non-Expo project.
 *
 * Deliberately never fails: a project whose config is unreadable falls back to
 * the pre-fix behaviour (no runtimeVersion recorded) instead of turning a
 * bookkeeping gap into a red build. The warning exists because silence is what
 * made this bug survive 27 builds in the first place.
 *
 * The Expo path does NOT come through here — there the config is the source of
 * the app metadata itself, so an unreadable config must stay fatal.
 */
export const readOtaExpoConfig = (params: {
  readonly projectRoot: string;
  readonly envVars: Record<string, string>;
  /** Names the operation in the warning, e.g. "build" or "upload". */
  readonly subject: string;
}) =>
  Effect.gen(function* () {
    if (!(yield* wantsOtaExpoConfig(params.projectRoot))) {
      return undefined;
    }
    return yield* readExpoConfig(params.projectRoot, params.envVars).pipe(
      Effect.catch((error) =>
        printWarn(
          `This project depends on expo-updates but its Expo config could not be read, so no OTA runtime version will be recorded for this ${params.subject}: ${formatCause(error)}`,
        ).pipe(Effect.as(undefined)),
      ),
    );
  });

/**
 * Best-effort runtimeVersion resolution for a non-Expo project.
 *
 * Same contract as `readOtaExpoConfig`: never fails. Resolution is not a pure
 * lookup — the `fingerprint` policy shells out to `@expo/fingerprint` and the
 * `sdkVersion` policy needs a resolvable `expo` install, so on a project that
 * merely happens to declare one, an offline runner or a missing package would
 * otherwise turn a bookkeeping field into a red build that was green before.
 *
 * The Expo path does NOT come through here: there a missing or unresolvable
 * runtimeVersion is a real misconfiguration and must stay fatal.
 */
export const resolveOtaRuntimeVersion = (
  params: ResolveRuntimeVersionOptions & {
    /** Names the operation in the warning, e.g. "build" or "upload". */
    readonly subject: string;
  },
) =>
  params.raw === undefined
    ? Effect.succeed(undefined)
    : resolveRuntimeVersion(params).pipe(
        Effect.catch((error) =>
          printWarn(
            `Could not resolve the OTA runtime version, so none will be recorded for this ${params.subject}: ${formatCause(error)}`,
          ).pipe(Effect.as(undefined)),
        ),
      );
