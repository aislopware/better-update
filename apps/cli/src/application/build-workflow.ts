import process from "node:process";

import { Prompt } from "@effect/cli";
import { Console, Effect } from "effect";

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
import { BuildProfileError } from "../lib/exit-codes";
import { readAppMetaFromConfig, readExpoConfig } from "../lib/expo-config";
import { readGitContext } from "../lib/git-context";
import { readGradleConfig, warnOnGradleMismatch } from "../lib/gradle-config";
import { printKeyValue } from "../lib/output";
import { resolveRuntimeVersion } from "../lib/runtime-version";
import { acquireBuildTempDir } from "../lib/temp-dir";
import { apiClient } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";

import type { DistributionValue } from "../commands/build/reserve-and-upload";
import type { Platform } from "../lib/build-profile";

export interface RunBuildWorkflowOptions {
  readonly platform: Platform;
  readonly profileName: string;
  readonly message: string | undefined;
  readonly noUpload: boolean;
  readonly rawOutput?: boolean;
}

export const runBuildWorkflow = (options: RunBuildWorkflowOptions) =>
  Effect.scoped(
    Effect.gen(function* () {
      const api = yield* apiClient;
      const runtime = yield* CliRuntime;
      const projectRoot = yield* runtime.cwd;

      const appJson = yield* readAppJson;
      const projectId = yield* readProjectId;

      const profile = yield* readBuildProfile(appJson, options.profileName);

      // Load env vars BEFORE resolving dynamic config — app.config.js may read process.env
      const envVars = yield* pullEnvVars(api, {
        projectId,
        environment: profile.environment,
      });

      // Set env vars so @expo/config's getConfig() picks them up
      for (const [key, value] of Object.entries(envVars)) {
        process.env[key] = value;
      }

      // Try @expo/config for dynamic configs (app.config.js/ts), fall back to static app.json
      const expoConfig = yield* readExpoConfig(projectRoot);
      const appMeta = expoConfig
        ? yield* readAppMetaFromConfig(expoConfig, options.platform).pipe(
            Effect.tap(() => Console.log("Resolved app config via @expo/config")),
            Effect.catchAll(() => readAppMeta(appJson, options.platform)),
          )
        : yield* readAppMeta(appJson, options.platform);

      const runtimeVersion = yield* resolveRuntimeVersion({
        raw: appMeta.rawRuntimeVersion,
        appVersion: appMeta.appVersion,
        projectRoot,
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
          rawOutput: options.rawOutput,
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

              const expo = appJson["expo"] as Record<string, unknown> | undefined;
              const appName = typeof expo?.["name"] === "string" ? expo["name"] : iosBundleId;

              yield* provisionIosCredentials({
                api,
                projectId,
                distribution: iosProfile.distribution,
                bundleIdentifier: iosBundleId,
                appName,
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
                rawOutput: options.rawOutput,
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

        // Cross-validate Gradle config against app.json (Groovy only)
        const androidDir = `${projectRoot}/android`;
        const gradleConfig = yield* readGradleConfig(androidDir);
        yield* warnOnGradleMismatch(gradleConfig, androidBundleId);

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
