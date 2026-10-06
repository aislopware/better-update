/**
 * `build --platform windows|linux`: the profile's `custom.<platform>` command
 * (electron-builder, Tauri, anything) run in a staged copy of the project,
 * then every installer or package it wrote that `artifactPath` matches
 * uploaded as its own build.
 *
 * Shares the macOS workflow's shell (clean-tree gate, env pull, staging,
 * lifecycle hooks) and none of its signing: Windows Authenticode and Linux
 * package signing stay with the toolchain, which reads its own variables.
 */
import path from "node:path";
import process from "node:process";

import { compact } from "@better-update/type-guards";
import { Effect, Result } from "effect";

import { runStep } from "../commands/build/run-step";
import { findArtifactsByGlob } from "../lib/artifact-finder";
import { readBuildProfile } from "../lib/build-profile";
import { clearBuildCaches } from "../lib/clear-cache";
import { asProjectType, detectProjectType } from "../lib/detect-project-type";
import { readEasProjectType } from "../lib/eas-json";
import { pullEnvVars } from "../lib/env-exporter";
import { BuildProfileError } from "../lib/exit-codes";
import { readGitContext } from "../lib/git-context";
import { printHuman, printKeyValue } from "../lib/output";
import { readProjectId } from "../lib/project-link";
import { prepareStagingProject } from "../lib/project-staging";
import { ensureRepoClean } from "../lib/repo-clean";
import { resolveProfileName } from "../lib/resolve-profile-name";
import { acquireBuildTempDir } from "../lib/temp-dir";
import { printWarn } from "../lib/warning-style";
import { apiClient } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";
import { exportArtifact } from "./build-artifact-output";
import { runBuildLifecycleHooks } from "./build-workflow";
import { describeDesktopArtifact, uploadDesktopArtifacts } from "./desktop-upload";

import type { CustomCommandSpec } from "../lib/eas-config";
import type { RunBuildWorkflowOptions } from "./build-workflow";
import type { DesktopUploadPlatform } from "./desktop-upload";

export type RunDesktopBuildWorkflowOptions = Omit<RunBuildWorkflowOptions, "platform" | "mutex"> & {
  readonly platform: DesktopUploadPlatform;
};

const EXAMPLE_COMMAND: Record<DesktopUploadPlatform, string> = {
  windows:
    '"custom": { "windows": { "command": "npx electron-builder --win nsis", "artifactPath": "dist/*.exe" } }',
  linux:
    '"custom": { "linux": { "command": "npx tauri build", "artifactPath": "src-tauri/target/release/bundle/**/*.{AppImage,deb,rpm}" } }',
};

/** The custom command through the platform's shell: `cmd` on Windows, `sh` elsewhere. */
const shellInvocation = (command: string) =>
  process.platform === "win32"
    ? { command: "cmd.exe", args: ["/d", "/s", "/c", command] }
    : { command: "sh", args: ["-c", command] };

/** Run the command; every matching file it wrote is a deliverable. */
const runDesktopCustomBuild = (params: {
  readonly platform: DesktopUploadPlatform;
  readonly custom: CustomCommandSpec & { readonly artifactPath: string };
  readonly projectRoot: string;
  readonly env: Readonly<Record<string, string>>;
}) =>
  Effect.gen(function* () {
    const { custom } = params;
    const cwd =
      custom.cwd === undefined ? params.projectRoot : path.join(params.projectRoot, custom.cwd);
    const commandEnv = yield* (yield* CliRuntime).commandEnvironment(params.env);
    const startedMs = Date.now();
    yield* runStep(
      { ...shellInvocation(custom.command), cwd, env: { ...commandEnv, ...custom.env } },
      `custom ${params.platform} build`,
    );
    const files = yield* findArtifactsByGlob({
      baseDir: cwd,
      pattern: custom.artifactPath,
      minMtimeMs: startedMs,
    });
    yield* printHuman(
      `Custom build produced ${files.map((file) => path.basename(file)).join(", ")}`,
    );
    return { files, cwd };
  });

/** `--output`: the file itself for one artifact, a directory of them for several. */
const exportOutputs = (files: readonly string[], userCwd: string, output: string | undefined) =>
  output === undefined
    ? Effect.succeed([])
    : Effect.all(
        files.map((file) =>
          exportArtifact({
            artifactPath: file,
            userCwd,
            output: files.length === 1 ? output : path.join(output, path.basename(file)),
          }),
        ),
      );

export const runDesktopBuildWorkflow = (options: RunDesktopBuildWorkflowOptions) =>
  Effect.scoped(
    // eslint-disable-next-line eslint/max-statements -- one sequential pipeline: config → stage → build → hooks → upload, sharing the scope that owns the staging dir
    Effect.gen(function* () {
      const { platform } = options;
      const api = yield* apiClient;
      const runtime = yield* CliRuntime;
      const userCwd = yield* runtime.cwd;

      yield* ensureRepoClean({
        projectRoot: userCwd,
        allowDirty: options.allowDirty ?? false,
        label: "build",
      });
      const projectType = yield* detectProjectType({
        projectRoot: userCwd,
        override: asProjectType(yield* readEasProjectType(userCwd)),
      });
      const projectId = yield* readProjectId;
      const profileName = yield* resolveProfileName(userCwd, options.profileName);
      const profile = yield* readBuildProfile(userCwd, profileName);
      const custom = profile.customCommand?.[platform];
      if (custom?.artifactPath === undefined) {
        return yield* new BuildProfileError({
          message: `Profile "${profile.name}" has no custom ${platform} command with an "artifactPath". ${platform === "windows" ? "Windows" : "Linux"} apps build with their own toolchain; add, for example:\n  ${EXAMPLE_COMMAND[platform]}`,
        });
      }
      if (options.autoSubmit === true) {
        yield* printWarn(
          `--auto-submit is ignored for ${platform}: there is no store to submit to.`,
        );
      }

      const remoteEnvVars = yield* pullEnvVars(api, {
        projectId,
        environment: profile.environment,
      });
      const rawGitContext = yield* readGitContext(userCwd);
      const desktop = profile[platform];
      const buildEnvVars = {
        ...remoteEnvVars,
        ...profile.env,
        BETTER_UPDATE_BUILD: "1",
        BETTER_UPDATE_BUILD_RUNNER: "cli",
        BETTER_UPDATE_BUILD_PLATFORM: platform,
        BETTER_UPDATE_BUILD_PROFILE: profile.name,
        BETTER_UPDATE_BUILD_PROJECT_ID: projectId,
        ...compact({
          BETTER_UPDATE_BUILD_GIT_COMMIT_HASH: rawGitContext.commit,
          BETTER_UPDATE_BUILD_APP_VERSION: desktop?.version,
          BETTER_UPDATE_BUILD_BUILD_NUMBER: desktop?.buildNumber,
        }),
      };

      if (options.clearCache) {
        yield* clearBuildCaches(userCwd);
      }
      const tempDir = yield* acquireBuildTempDir;
      const staging = yield* prepareStagingProject({
        userCwd,
        tempDir,
        envVars: buildEnvVars,
        projectType,
      });
      const buildEnv = { ...buildEnvVars, BETTER_UPDATE_BUILD_WORKINGDIR: staging.stagingRoot };
      yield* printHuman(`Building ${platform} for profile "${profile.name}" (custom command)`);

      const outcome = yield* Effect.result(
        runDesktopCustomBuild({
          platform,
          custom: { ...custom, artifactPath: custom.artifactPath },
          projectRoot: staging.projectRoot,
          env: buildEnv,
        }),
      );
      const lifecycleStatus = Result.isSuccess(outcome) ? "finished" : "errored";
      yield* runBuildLifecycleHooks({
        succeeded: Result.isSuccess(outcome),
        projectRoot: staging.projectRoot,
        packageManager: staging.packageManager,
        env: yield* runtime.commandEnvironment({
          ...buildEnv,
          BETTER_UPDATE_BUILD_STATUS: lifecycleStatus,
          EAS_BUILD_STATUS: lifecycleStatus,
        }),
      });
      if (Result.isFailure(outcome)) {
        return yield* Effect.fail(outcome.failure);
      }
      const { files, cwd } = outcome.success;
      const configDirs = cwd === staging.projectRoot ? [cwd] : [cwd, staging.projectRoot];
      const exported = yield* exportOutputs(files, userCwd, options.output);

      if (options.noUpload) {
        // Still read every file, so a build that could not be uploaded says why now.
        yield* Effect.all(
          files.map((artifactPath) =>
            describeDesktopArtifact({ platform, artifactPath, profile: desktop, configDirs }),
          ),
        );
        yield* printKeyValue([
          ["Artifacts", files.map((file) => path.basename(file)).join(", ")],
          ...(exported.length > 0 ? [["Exported to", exported.join(", ")] as const] : []),
          ["Upload", "skipped (--no-upload)"],
        ]);
        return;
      }
      yield* uploadDesktopArtifacts(api, {
        platform,
        artifactPaths: files,
        profile: desktop,
        profileName: profile.name,
        configDirs,
        projectId,
        gitContext: compact({
          ref: rawGitContext.ref,
          commit: rawGitContext.commit,
          dirty: rawGitContext.dirty,
        }),
        message: options.message,
      });
    }),
  );
