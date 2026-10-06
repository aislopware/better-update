import path from "node:path";

import { FileSystem, Effect } from "effect";

import { runBuildHook } from "../../lib/build-hooks";
import { ArtifactNotFoundError, BuildFailedError } from "../../lib/exit-codes";
import { setIosUpdateChannel } from "../../lib/update-channel-native";
import { runStep } from "./run-step";

import type { IosProfile } from "../../lib/build-profile";
import type { IosBuildStrategy } from "../../lib/build-strategy";
import type { PackageManager } from "../../lib/project-staging";
import type { RunStepCommand } from "./run-step";

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
  iosProfile: Pick<IosProfile, "workspace" | "project">,
  /** The eas.json section named in the "nothing found" hint. */
  section: "ios" | "macos" = "ios",
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
      message: `No .xcworkspace or .xcodeproj found under ${iosDir}. Set ${section}.workspace / ${section}.project in eas.json.`,
    });
  });

/**
 * Commands that install pods for a bare/native project. When the project root
 * has a Gemfile (the React Native template ships one pinning cocoapods and its
 * deps), pods go through bundler so `Gemfile.lock` is honoured — a bare `pod`
 * runs whatever gems the runner has, which breaks as soon as the host Ruby
 * moves on (e.g. json >= 2.10 rejecting cocoapods 1.15's `quirks_mode`).
 */
export const podInstallSteps = (params: {
  readonly projectRoot: string;
  readonly iosDir: string;
  readonly hasGemfile: boolean;
  readonly env: Record<string, string>;
}): readonly { readonly name: string; readonly command: RunStepCommand }[] =>
  params.hasGemfile
    ? [
        {
          name: "bundle install",
          command: {
            command: "bundle",
            args: ["install"],
            cwd: params.projectRoot,
            env: params.env,
          },
        },
        {
          name: "pod install",
          command: {
            command: "bundle",
            args: ["exec", "pod", "install"],
            cwd: params.iosDir,
            env: params.env,
          },
        },
      ]
    : [
        {
          name: "pod install",
          command: { command: "pod", args: ["install"], cwd: params.iosDir, env: params.env },
        },
      ];

/**
 * Prepare the `ios/` dir for an xcodebuild. Expo regenerates it from app.json
 * via prebuild (which installs deps + pods itself — no separate `pod install`);
 * bare/KMP/native build the committed dir and only run `pod install` when a
 * Podfile is present (unless disabled).
 *
 * CocoaPods requires a UTF-8 locale (it aborts on ASCII-8BIT shells), so every
 * step that may run pods forces `LANG=en_US.UTF-8` — same as EAS Build.
 */
export const prepareIosNative = (params: {
  readonly strategy: IosBuildStrategy;
  readonly projectRoot: string;
  readonly iosDir: string;
  readonly iosProfile: IosProfile;
  readonly commandEnv: Record<string, string>;
  /** Package manager of the staged workspace — used to run lifecycle hooks. */
  readonly packageManager: PackageManager;
  /** OTA channel baked into the generated Expo.plist; undefined skips injection. */
  readonly updateChannel?: string | undefined;
}) =>
  Effect.gen(function* () {
    const podEnv = { ...params.commandEnv, LANG: "en_US.UTF-8" };
    if (params.strategy === "expo") {
      yield* runStep(
        {
          command: "bunx",
          args: ["expo", "prebuild", "--platform", "ios", "--clean"],
          cwd: params.projectRoot,
          env: podEnv,
        },
        "expo prebuild ios",
      );
    } else if (params.iosProfile.podInstall !== false) {
      const fs = yield* FileSystem.FileSystem;
      const hasPodfile = yield* fs
        .exists(path.join(params.iosDir, "Podfile"))
        .pipe(Effect.orElseSucceed(() => false));
      if (hasPodfile) {
        const hasGemfile = yield* fs
          .exists(path.join(params.projectRoot, "Gemfile"))
          .pipe(Effect.orElseSucceed(() => false));
        const steps = podInstallSteps({
          projectRoot: params.projectRoot,
          iosDir: params.iosDir,
          hasGemfile,
          env: podEnv,
        });
        for (const step of steps) {
          yield* runStep(step.command, step.name);
        }
      }
    }

    // Bake the OTA channel AFTER prebuild (which regenerates `ios/`) and BEFORE
    // the archive — for every strategy that comes through here, not just "expo".
    // A committed Expo.plist is just as valid an injection target as a generated
    // one. This used to sit inside the prebuild branch above, so bare/native/kmp
    // builds shipped with an empty EXUpdatesRequestHeaders and silently fell
    // back to the server's default channel.
    //
    // The `custom` strategy never reaches this function — `runIosBuild` routes
    // it straight to `runIosCustom`, which does its own injection.
    if (params.updateChannel !== undefined) {
      yield* setIosUpdateChannel({ iosDir: params.iosDir, channel: params.updateChannel });
    }

    yield* runBuildHook({
      name: "eas-build-post-install",
      projectRoot: params.projectRoot,
      packageManager: params.packageManager,
      env: params.commandEnv,
    });
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
