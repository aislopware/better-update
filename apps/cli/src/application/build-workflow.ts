import { Prompt } from "@effect/cli";
import { Console, Effect } from "effect";

import type { PlatformError } from "@effect/platform/Error";

import { runAndroidBuild } from "../commands/build/android";
import {
  provisionAndroidCredentials,
  provisionIosCredentials,
} from "../commands/build/credential-provisioning";
import { runIosBuild } from "../commands/build/ios";
import { reserveAndUpload } from "../commands/build/reserve-and-upload";
import { readAppJson, readProjectId } from "../lib/app-json";
import { readAppMeta, readBuildProfile } from "../lib/build-profile";
import { pullEnvVars } from "../lib/env-exporter";
import { BuildProfileError, RuntimeVersionError } from "../lib/exit-codes";
import { readGitContext } from "../lib/git-context";
import { printKeyValue } from "../lib/output";
import { resolveRuntimeVersion } from "../lib/runtime-version";
import { acquireBuildTempDir } from "../lib/temp-dir";
import { apiClient } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";

import type { DistributionValue } from "../commands/build/reserve-and-upload";
import type { Platform } from "../lib/build-profile";
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
} from "../lib/exit-codes";

export interface RunBuildWorkflowOptions {
  readonly platform: Platform;
  readonly profileName: string;
  readonly message: string | undefined;
  readonly noUpload: boolean;
}

export type BuildWorkflowError =
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

export const runBuildWorkflow = (options: RunBuildWorkflowOptions) =>
  Effect.scoped(
    Effect.gen(function* () {
      const api = yield* apiClient;
      const runtime = yield* CliRuntime;
      const projectRoot = yield* runtime.cwd;

      const appJson = yield* readAppJson;
      const projectId = yield* readProjectId;

      const profile = yield* readBuildProfile(appJson, options.profileName);
      const appMeta = yield* readAppMeta(appJson, options.platform);

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
        `Building ${options.platform} artifact for profile "${profile.name}" (runtimeVersion=${runtimeVersion})`,
      );

      let build: { artifactPath: string; byteSize: number; sha256: string };
      let distribution: DistributionValue;
      let artifactFormat: "ipa" | "apk" | "aab";
      let bundleId: string;

      if (options.platform === "ios") {
        if (!profile.ios) {
          return yield* new BuildProfileError({
            message: `Profile "${profile.name}" has no ios section.`,
          });
        }

        const iosProfile = profile.ios;
        const iosBundleId = appMeta.bundleId;
        if (!iosBundleId) {
          return yield* new BuildProfileError({
            message: "Missing expo.ios.bundleIdentifier in app.json.",
          });
        }

        build = yield* runIosBuild({
          api,
          tempDir,
          projectRoot,
          iosProfile,
          bundleId: iosBundleId,
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
                bundleId: iosBundleId,
                envVars,
                projectId,
              });
            }),
          ),
        );
        distribution = iosProfile.distribution;
        artifactFormat = "ipa";
        bundleId = iosBundleId;
      } else {
        if (!profile.android) {
          return yield* new BuildProfileError({
            message: `Profile "${profile.name}" has no android section.`,
          });
        }

        const androidProfile = profile.android;
        const androidBundleId = appMeta.androidPackage;
        if (!androidBundleId) {
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
        bundleId = androidBundleId;
      }

      yield* Console.log(`Artifact produced: ${build.artifactPath}`);

      if (options.noUpload) {
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
        platform: options.platform,
        distribution,
        artifactFormat,
        profileName: profile.name,
        runtimeVersion,
        ...(appMeta.appVersion !== undefined ? { appVersion: appMeta.appVersion } : {}),
        ...(appMeta.buildNumber !== undefined ? { buildNumber: appMeta.buildNumber } : {}),
        bundleId,
        gitContext,
        ...(options.message !== undefined ? { message: options.message } : {}),
        artifactPath: build.artifactPath,
        sha256: build.sha256,
        byteSize: build.byteSize,
      });

      yield* Console.log("");
      yield* printKeyValue([
        ["Build ID", result.id],
        ["Status", result.status],
        ["Platform", options.platform],
        ["Profile", profile.name],
        ["Runtime version", runtimeVersion],
        ["Artifact", build.artifactPath],
        ["SHA-256", build.sha256],
        ["Bytes", String(build.byteSize)],
      ]);
    }),
  );
