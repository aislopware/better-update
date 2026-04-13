import process from "node:process";

import { Prompt } from "@effect/cli";
import { CommandExecutor, FetchHttpClient, FileSystem } from "@effect/platform";
import { Console, Effect } from "effect";

import type { PlatformError } from "@effect/platform/Error";

import { readAppJson, readProjectId } from "../../lib/app-json";
import { readAppMeta, readBuildProfile } from "../../lib/build-profile";
import { pullEnvVars } from "../../lib/env-exporter";
import { BuildProfileError, RuntimeVersionError } from "../../lib/exit-codes";
import { readGitContext } from "../../lib/git-context";
import { printKeyValue } from "../../lib/output";
import { resolveRuntimeVersion } from "../../lib/runtime-version";
import { acquireBuildTempDir } from "../../lib/temp-dir";
import { apiClient } from "../../services/api-client";
import { AuthStore } from "../../services/auth-store";
import { ConfigStore } from "../../services/config-store";
import { runAndroidBuild } from "./android";
import { provisionAndroidCredentials, provisionIosCredentials } from "./credential-provisioning";
import { runIosBuild } from "./ios";
import { reserveAndUpload } from "./reserve-and-upload";

import type { Platform } from "../../lib/build-profile";
import type {
  ArtifactNotFoundError,
  AuthRequiredError,
  BuildFailedError,
  CompleteError,
  EnvExportError,
  KeychainError,
  MissingCredentialsError,
  PresignedUrlExpiredError,
  ProjectNotLinkedError,
  ProvisioningError,
  ReserveError,
  UploadFailedError,
} from "../../lib/exit-codes";
import type { DistributionValue } from "./reserve-and-upload";

export interface RunBuildOrchestratorOptions {
  readonly platform: Platform;
  readonly profileName: string;
  readonly message: string | undefined;
  readonly noUpload: boolean;
}

export type OrchestratorError =
  | AuthRequiredError
  | ProjectNotLinkedError
  | BuildProfileError
  | RuntimeVersionError
  | EnvExportError
  | MissingCredentialsError
  | BuildFailedError
  | KeychainError
  | ProvisioningError
  | ArtifactNotFoundError
  | UploadFailedError
  | PresignedUrlExpiredError
  | ReserveError
  | CompleteError
  | PlatformError;

export const runBuildOrchestrator = (
  opts: RunBuildOrchestratorOptions,
): Effect.Effect<
  void,
  OrchestratorError,
  AuthStore | ConfigStore | CommandExecutor.CommandExecutor | FileSystem.FileSystem
> =>
  Effect.scoped(
    Effect.gen(function* () {
      const api = yield* apiClient;
      const projectRoot = process.cwd();

      const appJson = yield* readAppJson;
      const projectId = yield* readProjectId;

      const profile = yield* readBuildProfile(appJson, opts.profileName);
      const appMeta = yield* readAppMeta(appJson, opts.platform);

      const runtimeVersion = yield* resolveRuntimeVersion({
        raw: appMeta.rawRuntimeVersion,
        appVersion: appMeta.appVersion,
        projectRoot,
      });

      const envVars = yield* pullEnvVars(api, {
        projectId,
        environment: profile.environment,
      });

      const tempDir = yield* acquireBuildTempDir;

      yield* Console.log(
        `Building ${opts.platform} artifact for profile "${profile.name}" (runtimeVersion=${runtimeVersion})`,
      );

      let build: { artifactPath: string; byteSize: number; sha256: string };
      let distribution: DistributionValue;
      let artifactFormat: "ipa" | "apk" | "aab";
      let bundleId: string;

      if (opts.platform === "ios") {
        if (!profile.ios) {
          return yield* new BuildProfileError({
            message: `Profile "${profile.name}" has no ios section.`,
          });
        }
        const iosProfile = profile.ios;
        if (!appMeta.bundleId) {
          return yield* new BuildProfileError({
            message: "Missing expo.ios.bundleIdentifier in app.json.",
          });
        }
        build = yield* runIosBuild({
          api,
          tempDir,
          projectRoot,
          iosProfile,
          bundleId: appMeta.bundleId,
          envVars,
          projectId,
        }).pipe(
          Effect.catchTag("MissingCredentialsError", (error) =>
            Effect.gen(function* () {
              yield* Console.log("");
              yield* Console.log(error.message);
              yield* Console.log(error.hint);

              const shouldProvision = yield* Prompt.confirm({
                message: "Provision missing iOS credentials now?",
                initial: true,
              });
              if (!shouldProvision) {
                return yield* Effect.fail(error);
              }

              yield* provisionIosCredentials({
                api,
                projectId,
                distribution: iosProfile.distribution,
              });

              yield* Console.log("");
              yield* Console.log("Retrying iOS build...");

              return yield* runIosBuild({
                api,
                tempDir,
                projectRoot,
                iosProfile,
                bundleId: appMeta.bundleId,
                envVars,
                projectId,
              });
            }),
          ),
        );
        distribution = iosProfile.distribution;
        artifactFormat = "ipa";
        bundleId = appMeta.bundleId;
      } else {
        if (!profile.android) {
          return yield* new BuildProfileError({
            message: `Profile "${profile.name}" has no android section.`,
          });
        }
        const androidProfile = profile.android;
        if (!appMeta.androidPackage) {
          return yield* new BuildProfileError({
            message: "Missing expo.android.package in app.json.",
          });
        }
        build = yield* runAndroidBuild({
          api,
          tempDir,
          projectRoot,
          androidProfile,
          envVars,
          projectId,
        }).pipe(
          Effect.catchTag("MissingCredentialsError", (error) =>
            Effect.gen(function* () {
              yield* Console.log("");
              yield* Console.log(error.message);
              yield* Console.log(error.hint);

              const shouldProvision = yield* Prompt.confirm({
                message: "Provision missing Android credentials now?",
                initial: true,
              });
              if (!shouldProvision) {
                return yield* Effect.fail(error);
              }

              yield* provisionAndroidCredentials({
                api,
                projectId,
              });

              yield* Console.log("");
              yield* Console.log("Retrying Android build...");

              return yield* runAndroidBuild({
                api,
                tempDir,
                projectRoot,
                androidProfile,
                envVars,
                projectId,
              });
            }),
          ),
        );
        distribution = androidProfile.distribution;
        artifactFormat = androidProfile.format;
        bundleId = appMeta.androidPackage;
      }

      yield* Console.log(`Artifact produced: ${build.artifactPath}`);

      if (opts.noUpload) {
        yield* printKeyValue([
          ["Artifact", build.artifactPath],
          ["SHA-256", build.sha256],
          ["Bytes", String(build.byteSize)],
          ["Upload", "skipped (--no-upload)"],
        ]);
        return;
      }

      const rawGitContext = yield* readGitContext(projectRoot);
      const gitContext: {
        readonly ref?: string;
        readonly commit?: string;
        readonly dirty: boolean;
      } = {
        ...(rawGitContext.ref !== undefined ? { ref: rawGitContext.ref } : {}),
        ...(rawGitContext.commit !== undefined ? { commit: rawGitContext.commit } : {}),
        dirty: rawGitContext.dirty,
      };

      const result = yield* reserveAndUpload(api, {
        projectId,
        platform: opts.platform,
        distribution,
        artifactFormat,
        profileName: profile.name,
        runtimeVersion,
        ...(appMeta.appVersion !== undefined ? { appVersion: appMeta.appVersion } : {}),
        ...(appMeta.buildNumber !== undefined ? { buildNumber: appMeta.buildNumber } : {}),
        bundleId,
        gitContext,
        ...(opts.message !== undefined ? { message: opts.message } : {}),
        artifactPath: build.artifactPath,
        sha256: build.sha256,
        byteSize: build.byteSize,
      }).pipe(Effect.provide(FetchHttpClient.layer));

      yield* Console.log("");
      yield* printKeyValue([
        ["Build ID", result.id],
        ["Status", result.status],
        ["Platform", opts.platform],
        ["Profile", profile.name],
        ["Runtime version", runtimeVersion],
        ["Artifact", build.artifactPath],
        ["SHA-256", build.sha256],
        ["Bytes", String(build.byteSize)],
      ]);
    }),
  );
