import path from "node:path";

import { fromBase64 } from "@better-update/encoding";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import type { PlatformError } from "@effect/platform/Error";

import { MissingCredentialsError } from "./exit-codes";

import type { ApiClient } from "../services/api-client";
import type { IosDistribution } from "./build-profile";

export interface DownloadIosCredentialsOptions {
  readonly projectId: string;
  readonly bundleIdentifier: string;
  readonly distribution: IosDistribution;
  readonly tempDir: string;
}

export interface IosCredentials {
  readonly p12Path: string;
  readonly p12Password: string;
  readonly profilePath: string;
  readonly profileFilename: string;
  readonly teamId: string;
}

const IOS_DISTRIBUTION_TO_TYPE = {
  "app-store": "APP_STORE",
  "ad-hoc": "AD_HOC",
  development: "DEVELOPMENT",
  enterprise: "ENTERPRISE",
} as const satisfies Record<IosDistribution, "APP_STORE" | "AD_HOC" | "DEVELOPMENT" | "ENTERPRISE">;

const bindHint =
  "Bind the bundle via the dashboard (Credentials → iOS Bundle Configurations) and make sure a distribution certificate, provisioning profile, and ASC API key are attached.";

const permissionHint = "Ask an org admin to grant the build-credentials download permission.";

const androidBindHint =
  "Register the package in the dashboard (Credentials → Android Build Credentials) and bind a keystore to the default group.";

interface TaggedCause {
  readonly _tag: string;
  readonly message?: string;
}

const hasTag = (cause: unknown): cause is TaggedCause =>
  typeof cause === "object" && cause !== null && "_tag" in cause;

const resolveErrorToMissingCredentials = (
  cause: unknown,
  platform: "ios" | "android",
): MissingCredentialsError => {
  const tag = hasTag(cause) ? cause._tag : null;
  const message = hasTag(cause) && typeof cause.message === "string" ? cause.message : null;
  const platformLabel = platform === "ios" ? "iOS" : "Android";
  const bind = platform === "ios" ? bindHint : androidBindHint;

  if (tag === "Forbidden") {
    return new MissingCredentialsError({
      message: message ?? `Permission denied when resolving ${platformLabel} build credentials`,
      hint: permissionHint,
    });
  }
  if (tag === "NotFound") {
    return new MissingCredentialsError({
      message: message ?? `No ${platformLabel} build credentials configured`,
      hint: bind,
    });
  }
  if (tag === "BadRequest") {
    return new MissingCredentialsError({
      message: message ?? `${platformLabel} build credentials are misconfigured`,
      hint: bind,
    });
  }
  return new MissingCredentialsError({
    message: message ?? `Failed to resolve ${platformLabel} build credentials`,
    hint: bind,
  });
};

export const downloadIosCredentials = (
  api: ApiClient,
  options: DownloadIosCredentialsOptions,
): Effect.Effect<IosCredentials, MissingCredentialsError | PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const resolved = yield* api.buildCredentials
      .resolve({
        path: { projectId: options.projectId },
        payload: {
          platform: "ios" as const,
          bundleIdentifier: options.bundleIdentifier,
          distributionType: IOS_DISTRIBUTION_TO_TYPE[options.distribution],
        },
      })
      .pipe(Effect.mapError((cause) => resolveErrorToMissingCredentials(cause, "ios")));

    if (resolved.platform !== "ios") {
      return yield* Effect.fail(
        new MissingCredentialsError({
          message: "Server returned non-iOS credentials for an iOS build request",
          hint: bindHint,
        }),
      );
    }

    const p12Path = path.join(options.tempDir, "signing.p12");
    const profileFilename = `${resolved.provisioningProfile.uuid ?? "profile"}.mobileprovision`;
    const profilePath = path.join(options.tempDir, profileFilename);

    yield* fs.writeFile(p12Path, fromBase64(resolved.distributionCertificate.p12Base64));
    yield* fs.writeFile(
      profilePath,
      fromBase64(resolved.provisioningProfile.mobileprovisionBase64),
    );

    return {
      p12Path,
      p12Password: resolved.distributionCertificate.p12Password,
      profilePath,
      profileFilename,
      teamId: resolved.provisioningProfile.teamId,
    };
  });

export interface DownloadAndroidCredentialsOptions {
  readonly projectId: string;
  readonly applicationIdentifier: string;
  readonly tempDir: string;
}

export interface AndroidCredentials {
  readonly keystorePath: string;
  readonly storePassword: string;
  readonly keyAlias: string;
  readonly keyPassword: string;
}

export const downloadAndroidCredentials = (
  api: ApiClient,
  options: DownloadAndroidCredentialsOptions,
): Effect.Effect<
  AndroidCredentials,
  MissingCredentialsError | PlatformError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const resolved = yield* api.buildCredentials
      .resolve({
        path: { projectId: options.projectId },
        payload: {
          platform: "android" as const,
          applicationIdentifier: options.applicationIdentifier,
        },
      })
      .pipe(Effect.mapError((cause) => resolveErrorToMissingCredentials(cause, "android")));

    if (resolved.platform !== "android") {
      return yield* Effect.fail(
        new MissingCredentialsError({
          message: "Server returned non-Android credentials for an Android build request",
          hint: androidBindHint,
        }),
      );
    }

    const keystorePath = path.join(options.tempDir, "upload.keystore");
    yield* fs.writeFile(keystorePath, fromBase64(resolved.keystore.keystoreBase64));

    return {
      keystorePath,
      storePassword: resolved.keystore.storePassword,
      keyAlias: resolved.keystore.keyAlias,
      keyPassword: resolved.keystore.keyPassword,
    };
  });
