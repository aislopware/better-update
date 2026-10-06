/**
 * `build --platform macos`: a Developer ID app, built from the committed Xcode
 * project or a custom command, signed with the vault certificate, packaged,
 * notarized and uploaded.
 *
 * Shares the mobile workflow's shell (clean-tree gate, env pull, staging,
 * lifecycle hooks, upload) and none of its OTA parts: a macOS build has no
 * runtime version, fingerprint or update channel. Credentials are settled
 * before the build so a missing certificate or notary key fails in seconds,
 * not after a ten-minute archive.
 */
import path from "node:path";

import { compact } from "@better-update/type-guards";
import { Effect, Result } from "effect";

import type { MacosBuildMetadata, MacosNotarization } from "@better-update/api";

import { runMacosBuild } from "../commands/build/macos";
import { reserveAndUpload } from "../commands/build/reserve-and-upload";
import { readBuildProfile } from "../lib/build-profile";
import { resolveMacosStrategy } from "../lib/build-strategy";
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
import { sha256File } from "../lib/sha256";
import { readTauriUpdaterPubkey } from "../lib/tauri-config";
import { acquireBuildTempDir } from "../lib/temp-dir";
import { printWarn } from "../lib/warning-style";
import { apiClient } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";
import { attachBuildCompanions, exportBuildOutputs } from "./build-companions";
import { runBuildLifecycleHooks } from "./build-workflow";
import { finishMacosBuild, resolveBuildNotaryAuth } from "./macos-build-finish";
import { resolveDeveloperIdProfiles } from "./macos-provisioning";
import { acquireDeveloperIdIdentity, acquireMacosWorkDir } from "./macos-signing-identity";

import type { MacosProfile } from "../lib/build-profile";
import type { RunBuildWorkflowOptions } from "./build-workflow";
import type { FinishedMacosBuild } from "./macos-build-finish";

export type RunMacosBuildWorkflowOptions = Omit<RunBuildWorkflowOptions, "platform" | "mutex">;

const NOTARIZATION_LABEL: Record<MacosNotarization["status"], string> = {
  accepted: "accepted",
  pending: "pending with Apple",
  skipped: "skipped",
};

const buildMetadata = (
  finished: FinishedMacosBuild,
  teamId: string,
  tauriPublicKey: string | undefined,
): { readonly macos: MacosBuildMetadata } => ({
  macos: compact({
    appName: finished.appInfo.name,
    minimumSystemVersion: finished.appInfo.minimumSystemVersion,
    architectures:
      finished.appInfo.architectures.length === 0 ? undefined : finished.appInfo.architectures,
    teamId,
    sparklePublicKey: finished.appInfo.sparklePublicKey,
    tauriPublicKey,
    notarization: finished.notarization,
  }),
});

/** Where a Tauri project's config may live: the project root and a custom command's `cwd`. */
const tauriConfigDirs = (
  projectRoot: string,
  profile: { readonly customCommand?: { readonly macos?: { readonly cwd?: string } } },
) => {
  const cwd = profile.customCommand?.macos?.cwd;
  return cwd === undefined ? [projectRoot] : [path.join(projectRoot, cwd), projectRoot];
};

/** What to run once Apple finishes a submission that outlived the wait. */
const resumeHint = (finished: FinishedMacosBuild, exportedPath: string | undefined) =>
  finished.notarization.status === "pending" && finished.notarization.submissionId !== undefined
    ? printWarn(
        `Apple is still processing the notarization. The uploaded ${finished.format} opens once it is accepted, but carries no stapled ticket for offline first launch. To staple a local copy:\n  better-update macos notarize "${exportedPath ?? "<path>"}" --submission-id ${finished.notarization.submissionId}`,
      )
    : Effect.void;

/** Signing identities and notary credentials, settled before any compiling. */
const acquireMacosCredentials = (
  api: Effect.Success<typeof apiClient>,
  macos: MacosProfile,
  workDir: string,
) =>
  Effect.gen(function* () {
    const application = yield* acquireDeveloperIdIdentity(api, {
      kind: "DEVELOPER_ID_APPLICATION",
      certificateId: undefined,
      workDir,
    });
    const installer =
      macos.artifact === "pkg"
        ? yield* acquireDeveloperIdIdentity(api, {
            kind: "DEVELOPER_ID_INSTALLER",
            certificateId: undefined,
            workDir,
          })
        : undefined;
    const notaryAuth = macos.notarize
      ? yield* resolveBuildNotaryAuth(api, {
          profileKeyId: macos.ascApiKeyId,
          teamId: application.teamId,
        })
      : undefined;
    return { application, installer, notaryAuth };
  });

export const runMacosBuildWorkflow = (options: RunMacosBuildWorkflowOptions) =>
  Effect.scoped(
    // eslint-disable-next-line eslint/max-statements -- one sequential pipeline: config → credentials → stage → build → package/notarize → upload; splitting it scatters the scope that owns the keychain and work dir
    Effect.gen(function* () {
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
      const { macos } = profile;
      if (macos === undefined) {
        return yield* new BuildProfileError({
          message: `Profile "${profile.name}" has no macos section. Add "macos": { "artifact": "dmg" } (or a custom.macos command) to it in eas.json.`,
        });
      }
      if (options.autoSubmit === true) {
        yield* printWarn("--auto-submit is ignored for macOS: Developer ID apps ship directly.");
      }

      const remoteEnvVars = yield* pullEnvVars(api, {
        projectId,
        environment: profile.environment,
      });
      const envVars = { ...remoteEnvVars, ...profile.env };
      const rawGitContext = yield* readGitContext(userCwd);

      const workDir = yield* acquireMacosWorkDir;
      const { application, installer, notaryAuth } = yield* acquireMacosCredentials(
        api,
        macos,
        workDir,
      );

      const buildEnvVars = {
        ...envVars,
        BETTER_UPDATE_BUILD: "1",
        BETTER_UPDATE_BUILD_RUNNER: "cli",
        BETTER_UPDATE_BUILD_PLATFORM: "macos",
        BETTER_UPDATE_BUILD_PROFILE: profile.name,
        BETTER_UPDATE_BUILD_PROJECT_ID: projectId,
        ...compact({
          BETTER_UPDATE_BUILD_GIT_COMMIT_HASH: rawGitContext.commit,
          BETTER_UPDATE_BUILD_MACOS_APP_VERSION: macos.metaOverride?.version,
          BETTER_UPDATE_BUILD_MACOS_BUILD_NUMBER: macos.metaOverride?.buildNumber,
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
      const strategy = resolveMacosStrategy(profile);

      yield* printHuman(
        `Building macos ${macos.artifact} for profile "${profile.name}" (Developer ID, ${strategy})`,
      );

      const outcome = yield* Effect.result(
        Effect.gen(function* () {
          const product = yield* runMacosBuild({
            tempDir,
            projectRoot: staging.projectRoot,
            macosProfile: macos,
            strategy,
            customCommand: profile.customCommand?.macos,
            envVars: buildEnv,
            packageManager: staging.packageManager,
            rawOutput: options.rawOutput,
            identity: application,
            resolveProfiles: (needs) =>
              resolveDeveloperIdProfiles(api, {
                needs,
                identity: application,
                workDir,
                ascApiKeyId: resolveBuildNotaryAuth(api, {
                  profileKeyId: macos.ascApiKeyId,
                  teamId: application.teamId,
                }).pipe(Effect.map((auth) => auth.ascApiKeyId)),
              }),
          });
          const finished = yield* finishMacosBuild(api, {
            product,
            profile: macos,
            projectRoot: staging.projectRoot,
            workDir,
            application,
            installer,
            notaryAuth,
          });
          return { product, finished };
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
      const { product, finished } = outcome.success;
      const { sha256, byteSize } = yield* sha256File(finished.artifactPath);
      const build = {
        artifactPath: finished.artifactPath,
        sha256,
        byteSize,
        debugArtifacts: product.debugArtifacts,
        installArtifact: undefined,
      };
      yield* printHuman(`Artifact produced: ${build.artifactPath}`);
      const exportedArtifactPath = yield* exportBuildOutputs({
        build,
        userCwd,
        output: options.output,
      });
      const summary = [
        ["Notarization", NOTARIZATION_LABEL[finished.notarization.status]],
        ["Stapled", finished.notarization.stapled ? "yes" : "no"],
        ["SHA-256", sha256],
        ["Bytes", String(byteSize)],
      ] as const;

      if (options.noUpload) {
        yield* printKeyValue([
          ["Artifact", build.artifactPath],
          ...(exportedArtifactPath ? [["Exported to", exportedArtifactPath] as const] : []),
          ...summary,
          ["Upload", "skipped (--no-upload)"],
        ]);
        yield* resumeHint(finished, exportedArtifactPath);
        return;
      }

      const bundleId = finished.appInfo.bundleId ?? macos.metaOverride?.bundleIdentifier;
      if (bundleId === undefined) {
        return yield* new BuildProfileError({
          message:
            "The built app has no CFBundleIdentifier; set macos.bundleIdentifier in eas.json.",
        });
      }
      const result = yield* reserveAndUpload(api, {
        target: {
          platform: "macos",
          distribution: "developer-id",
          artifactFormat: finished.format,
        },
        projectId,
        profileName: profile.name,
        bundleId,
        gitContext: compact({
          ref: rawGitContext.ref,
          commit: rawGitContext.commit,
          dirty: rawGitContext.dirty,
        }),
        artifactPath: build.artifactPath,
        sha256,
        byteSize,
        metadata: buildMetadata(
          finished,
          application.teamId,
          yield* readTauriUpdaterPubkey(tauriConfigDirs(staging.projectRoot, profile)),
        ),
        ...compact({
          appVersion: finished.appInfo.version ?? macos.metaOverride?.version,
          buildNumber: finished.appInfo.buildNumber ?? macos.metaOverride?.buildNumber,
          message: options.message,
        }),
      });
      const companions = yield* attachBuildCompanions(api, { buildId: result.id, build });

      yield* printHuman("");
      yield* printKeyValue([
        ["Build ID", result.id],
        ["Status", result.status],
        ["Platform", "macos"],
        ["Profile", profile.name],
        ["Artifact", build.artifactPath],
        ...summary,
        [
          "Debug artifacts",
          companions.debugArtifacts.length === 0 ? "none" : companions.debugArtifacts.join(", "),
        ],
      ]);
      yield* resumeHint(finished, exportedArtifactPath);
    }),
  );
