import path from "node:path";

import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { ArtifactNotFoundError, BuildFailedError } from "../../lib/exit-codes";
import { setIosUpdateChannel } from "../../lib/update-channel-native";
import { runStep } from "./run-step";

import type { IosProfile } from "../../lib/build-profile";
import type { IosBuildStrategy } from "../../lib/build-strategy";

export interface XcodeContainer {
  readonly flag: "-workspace" | "-project";
  /** Absolute path to the `.xcworkspace` / `.xcodeproj`. */
  readonly containerPath: string;
  /** Default scheme name (container basename without extension). */
  readonly schemeBase: string;
}

const baseName = (entry: string): string => entry.replace(/\.(?<ext>xcworkspace|xcodeproj)$/u, "");

/**
 * Resolve the Xcode container to build: an explicit `workspace`/`project` from
 * the profile, else an auto-discovered `.xcworkspace` (CocoaPods), else the
 * `.xcodeproj` (pure-native apps without Pods).
 */
export const resolveXcodeContainer = (
  projectRoot: string,
  iosDir: string,
  iosProfile: IosProfile,
): Effect.Effect<XcodeContainer, BuildFailedError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    if (iosProfile.workspace !== undefined) {
      const containerPath = path.resolve(projectRoot, iosProfile.workspace);
      return {
        flag: "-workspace",
        containerPath,
        schemeBase: baseName(path.basename(containerPath)),
      };
    }
    if (iosProfile.project !== undefined) {
      const containerPath = path.resolve(projectRoot, iosProfile.project);
      return {
        flag: "-project",
        containerPath,
        schemeBase: baseName(path.basename(containerPath)),
      };
    }
    const fs = yield* FileSystem.FileSystem;
    const entries = yield* fs.readDirectory(iosDir).pipe(Effect.orElseSucceed(() => []));
    const workspace = entries.find((entry) => entry.endsWith(".xcworkspace"));
    if (workspace !== undefined) {
      return {
        flag: "-workspace",
        containerPath: path.join(iosDir, workspace),
        schemeBase: baseName(workspace),
      };
    }
    const project = entries.find((entry) => entry.endsWith(".xcodeproj"));
    if (project !== undefined) {
      return {
        flag: "-project",
        containerPath: path.join(iosDir, project),
        schemeBase: baseName(project),
      };
    }
    return yield* new BuildFailedError({
      step: "resolve Xcode container",
      exitCode: 1,
      message: `No .xcworkspace or .xcodeproj found under ${iosDir}. Set ios.workspace / ios.project in eas.json.`,
    });
  });

/**
 * Prepare the `ios/` dir for an xcodebuild. Expo regenerates it from app.json
 * via prebuild then runs `pod install`; bare/KMP/native build the committed dir
 * and only run `pod install` when a Podfile is present (unless disabled).
 */
export const prepareIosNative = (params: {
  readonly strategy: IosBuildStrategy;
  readonly projectRoot: string;
  readonly iosDir: string;
  readonly iosProfile: IosProfile;
  readonly commandEnv: Record<string, string>;
  /** OTA channel baked into the generated Expo.plist; undefined skips injection. */
  readonly updateChannel?: string | undefined;
}) =>
  Effect.gen(function* () {
    if (params.strategy === "expo") {
      yield* runStep(
        {
          command: "bunx",
          args: ["expo", "prebuild", "--platform", "ios", "--clean"],
          cwd: params.projectRoot,
          env: params.commandEnv,
        },
        "expo prebuild ios",
      );
      if (params.updateChannel !== undefined) {
        yield* setIosUpdateChannel({ iosDir: params.iosDir, channel: params.updateChannel });
      }
      yield* runStep(
        { command: "pod", args: ["install"], cwd: params.iosDir, env: params.commandEnv },
        "pod install",
      );
      return;
    }
    if (params.iosProfile.podInstall === false) {
      return;
    }
    const fs = yield* FileSystem.FileSystem;
    const hasPodfile = yield* fs
      .exists(path.join(params.iosDir, "Podfile"))
      .pipe(Effect.orElseSucceed(() => false));
    if (hasPodfile) {
      yield* runStep(
        { command: "pod", args: ["install"], cwd: params.iosDir, env: params.commandEnv },
        "pod install",
      );
    }
  });

/** Recursively locate the first `.app` bundle under `root` (simulator output). */
export const findAppDirectory = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const stack = [root];
    let depth = 0;
    while (stack.length > 0 && depth < 6) {
      const layer = stack.splice(0);
      depth += 1;
      for (const dir of layer) {
        const entries = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => []));
        for (const entry of entries) {
          const full = path.join(dir, entry);
          if (entry.endsWith(".app")) {
            return full;
          }
          const stat = yield* fs.stat(full).pipe(Effect.option);
          if (stat._tag === "Some" && stat.value.type === "Directory") {
            stack.push(full);
          }
        }
      }
    }
    return yield* new ArtifactNotFoundError({
      message: `No .app bundle found under "${root}".`,
    });
  });
