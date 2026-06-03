import path from "node:path";

import { fromBase64 } from "@better-update/encoding";
import { compact } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { Console, Effect } from "effect";

import type { PlatformError } from "@effect/platform/Error";

import { autoProvisionExtensionProfile } from "./auto-provision-extension-profiles";
import { decryptResolveSecret, openVaultSessionForBuild } from "./build-credential-decrypt";
import { MissingCredentialsError } from "./exit-codes";

import type { VaultSession } from "../application/credential-cipher";
import type { ApiClient } from "../services/api-client";
import type { CliRuntime } from "../services/cli-runtime";
import type { IdentityStore } from "../services/identity-store";
import type { IosDistribution } from "./build-profile";
import type { InteractiveMode } from "./interactive-mode";

export interface DownloadIosCredentialsOptions {
  readonly projectId: string;
  /**
   * Bundle id of the main app target. Must already be registered in the
   * backend (`IosBundleConfiguration`) — its `context` provides the ASC key +
   * dist cert used to auto-provision any missing extension bundles.
   */
  readonly mainBundleIdentifier: string;
  /**
   * One entry per signed target: main app + any extensions discovered from the
   * Xcode project. Extensions missing on the backend are auto-provisioned when
   * the main bundle has an ASC API key bound.
   */
  readonly bundleIdentifiers: readonly string[];
  readonly distribution: IosDistribution;
  readonly tempDir: string;
}

export interface IosCredentialProfile {
  readonly bundleIdentifier: string;
  readonly profilePath: string;
  readonly profileFilename: string;
}

export interface IosCredentials {
  readonly p12Path: string;
  readonly p12Password: string;
  /**
   * One entry per signed target. For local credentials, the first entry is the
   * main app (from `provisioningProfilePath`); additional entries come from
   * `additionalProvisioningProfiles`. For remote, each entry is the result of
   * one `/build-credentials/resolve` call per signed bundle identifier.
   */
  readonly profiles: readonly IosCredentialProfile[];
}

export const IOS_DISTRIBUTION_TO_TYPE = {
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
  bundleIdentifier?: string,
): MissingCredentialsError => {
  const tag = hasTag(cause) ? cause._tag : null;
  const message = hasTag(cause) && typeof cause.message === "string" ? cause.message : null;
  const platformLabel = platform === "ios" ? "iOS" : "Android";
  const bind = platform === "ios" ? bindHint : androidBindHint;
  const bundleSuffix = bundleIdentifier ? ` (bundle "${bundleIdentifier}")` : "";

  if (tag === "Forbidden") {
    return new MissingCredentialsError({
      message:
        message ??
        `Permission denied when resolving ${platformLabel} build credentials${bundleSuffix}`,
      hint: permissionHint,
    });
  }
  if (tag === "NotFound") {
    return new MissingCredentialsError({
      message: message ?? `No ${platformLabel} build credentials configured${bundleSuffix}`,
      hint: bind,
    });
  }
  if (tag === "BadRequest") {
    return new MissingCredentialsError({
      message: message ?? `${platformLabel} build credentials are misconfigured${bundleSuffix}`,
      hint: bind,
    });
  }
  return new MissingCredentialsError({
    message: message ?? `Failed to resolve ${platformLabel} build credentials${bundleSuffix}`,
    hint: bind,
  });
};

interface ResolvedIosContext {
  readonly ascApiKeyId: string | null;
  readonly distributionCertificateId: string;
  readonly appleTeamId: string;
  readonly appleTeamIdentifier: string;
}

interface ResolvedIosCredential {
  readonly bundleIdentifier: string;
  readonly p12Base64: string;
  readonly p12Password: string;
  readonly mobileprovisionBase64: string;
  /** Mirrors the API client's nullable shape; consumers fall back to bundleId when null. */
  readonly profileUuid: string | null;
  readonly context: ResolvedIosContext;
}

type ResolveSettled =
  | {
      readonly status: "ok";
      readonly bundleIdentifier: string;
      readonly value: ResolvedIosCredential;
    }
  | { readonly status: "not-registered"; readonly bundleIdentifier: string }
  | {
      readonly status: "failed";
      readonly bundleIdentifier: string;
      readonly error: MissingCredentialsError;
    };

const resolveOneBundleSettled = (
  api: ApiClient,
  options: {
    readonly projectId: string;
    readonly bundleIdentifier: string;
    readonly distribution: IosDistribution;
    readonly session: VaultSession;
  },
): Effect.Effect<ResolveSettled, PlatformError> =>
  api.buildCredentials
    .resolve({
      path: { projectId: options.projectId },
      payload: {
        platform: "ios" as const,
        bundleIdentifier: options.bundleIdentifier,
        distributionType: IOS_DISTRIBUTION_TO_TYPE[options.distribution],
      },
    })
    .pipe(
      Effect.flatMap((resolved): Effect.Effect<ResolveSettled> => {
        if (resolved.platform !== "ios") {
          return Effect.succeed({
            status: "failed",
            bundleIdentifier: options.bundleIdentifier,
            error: new MissingCredentialsError({
              message: `Server returned non-iOS credentials for iOS bundle "${options.bundleIdentifier}"`,
              hint: bindHint,
            }),
          });
        }
        // Decrypt the .p12 envelope locally — bound (AAD) to the dist-cert row id
        // surfaced in `context`. The server never holds the plaintext.
        return decryptResolveSecret({
          session: options.session,
          credentialType: "distribution-certificate",
          credentialId: resolved.context.distributionCertificateId,
          envelope: resolved.distributionCertificate,
          fields: ["p12Base64", "p12Password"],
          hint: bindHint,
        }).pipe(
          Effect.map(
            (secret): ResolveSettled => ({
              status: "ok",
              bundleIdentifier: options.bundleIdentifier,
              value: {
                bundleIdentifier: options.bundleIdentifier,
                p12Base64: secret.p12Base64,
                p12Password: secret.p12Password,
                mobileprovisionBase64: resolved.provisioningProfile.mobileprovisionBase64,
                profileUuid: resolved.provisioningProfile.uuid,
                context: resolved.context,
              },
            }),
          ),
          Effect.catchAll(
            (error): Effect.Effect<ResolveSettled> =>
              Effect.succeed({
                status: "failed",
                bundleIdentifier: options.bundleIdentifier,
                error,
              }),
          ),
        );
      }),
      Effect.catchAll((cause): Effect.Effect<ResolveSettled> => {
        // Inspect raw API-error tag before conversion — only NotFound (bundle
        // not registered) is auto-provisionable; Forbidden/BadRequest/etc
        // surface as hard failures.
        const tag = hasTag(cause) ? cause._tag : null;
        if (tag === "NotFound") {
          return Effect.succeed({
            status: "not-registered",
            bundleIdentifier: options.bundleIdentifier,
          });
        }
        return Effect.succeed({
          status: "failed",
          bundleIdentifier: options.bundleIdentifier,
          error: resolveErrorToMissingCredentials(cause, "ios", options.bundleIdentifier),
        });
      }),
    );

const autoProvisionHint =
  "Upload an ASC API key for this Apple team in the dashboard (Credentials → ASC API Keys) so missing extension bundles can be auto-provisioned, or register them manually.";

export const downloadIosCredentials = (
  api: ApiClient,
  options: DownloadIosCredentialsOptions,
): Effect.Effect<
  IosCredentials,
  MissingCredentialsError | PlatformError,
  FileSystem.FileSystem | CliRuntime | IdentityStore | InteractiveMode
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    if (options.bundleIdentifiers.length === 0) {
      return yield* new MissingCredentialsError({
        message: "downloadIosCredentials called with an empty bundleIdentifiers list.",
        hint: bindHint,
      });
    }
    if (!options.bundleIdentifiers.includes(options.mainBundleIdentifier)) {
      return yield* new MissingCredentialsError({
        message: `Main bundle "${options.mainBundleIdentifier}" missing from bundleIdentifiers list.`,
        hint: bindHint,
      });
    }

    const session = yield* openVaultSessionForBuild(api, bindHint);
    const settled = yield* Effect.forEach(
      options.bundleIdentifiers,
      (bundleIdentifier) =>
        resolveOneBundleSettled(api, {
          projectId: options.projectId,
          bundleIdentifier,
          distribution: options.distribution,
          session,
        }),
      { concurrency: 4 },
    );

    const hardFailure = settled.find(
      (entry): entry is Extract<ResolveSettled, { status: "failed" }> => entry.status === "failed",
    );
    if (hardFailure) {
      return yield* hardFailure.error;
    }

    const mainEntry = settled.find(
      (entry) => entry.bundleIdentifier === options.mainBundleIdentifier,
    );
    if (mainEntry?.status !== "ok") {
      return yield* new MissingCredentialsError({
        message: `Main app bundle "${options.mainBundleIdentifier}" is not registered on the backend.`,
        hint: bindHint,
      });
    }

    const resolved = settled.filter(
      (entry): entry is Extract<ResolveSettled, { status: "ok" }> => entry.status === "ok",
    );
    const missing = settled
      .filter(
        (entry): entry is Extract<ResolveSettled, { status: "not-registered" }> =>
          entry.status === "not-registered",
      )
      .map((entry) => entry.bundleIdentifier);

    const provisioned = yield* maybeAutoProvision(api, {
      mainContext: mainEntry.value.context,
      missing,
      projectId: options.projectId,
      distributionType: IOS_DISTRIBUTION_TO_TYPE[options.distribution],
    });

    const p12Path = path.join(options.tempDir, "signing.p12");
    yield* fs.writeFile(p12Path, fromBase64(mainEntry.value.p12Base64));

    const profiles: IosCredentialProfile[] = [];
    for (const entry of resolved) {
      profiles.push(
        yield* writeProfile(fs, options.tempDir, {
          bundleIdentifier: entry.value.bundleIdentifier,
          base64: entry.value.mobileprovisionBase64,
          uuid: entry.value.profileUuid,
        }),
      );
    }
    for (const entry of provisioned) {
      profiles.push(
        yield* writeProfile(fs, options.tempDir, {
          bundleIdentifier: entry.bundleIdentifier,
          base64: entry.profileBase64,
          uuid: entry.profileUuid,
        }),
      );
    }

    return {
      p12Path,
      p12Password: mainEntry.value.p12Password,
      profiles,
    };
  });

interface AutoProvisionedEntry {
  readonly bundleIdentifier: string;
  readonly profileBase64: string;
  readonly profileUuid: string;
}

const maybeAutoProvision = (
  api: ApiClient,
  params: {
    readonly mainContext: ResolvedIosContext;
    readonly missing: readonly string[];
    readonly projectId: string;
    readonly distributionType: "APP_STORE" | "AD_HOC" | "DEVELOPMENT" | "ENTERPRISE";
  },
): Effect.Effect<
  readonly AutoProvisionedEntry[],
  MissingCredentialsError | PlatformError,
  CliRuntime | IdentityStore | InteractiveMode
> =>
  Effect.gen(function* () {
    if (params.missing.length === 0) {
      return [] as readonly AutoProvisionedEntry[];
    }
    const { ascApiKeyId } = params.mainContext;
    if (ascApiKeyId === null) {
      const list = params.missing.map((id) => `"${id}"`).join(", ");
      return yield* new MissingCredentialsError({
        message: `No iOS bundle configuration for extension bundle(s) ${list}, and no ASC API key is available for this Apple team to auto-provision them.`,
        hint: autoProvisionHint,
      });
    }
    yield* Console.log(
      `Auto-provisioning ${params.missing.length} missing extension profile(s) via Apple ASC...`,
    );
    return yield* Effect.forEach(
      params.missing,
      (bundleIdentifier) =>
        autoProvisionExtensionProfile(api, {
          projectId: params.projectId,
          bundleIdentifier,
          distributionType: params.distributionType,
          ascApiKeyId,
          distributionCertificateId: params.mainContext.distributionCertificateId,
          appleTeamId: params.mainContext.appleTeamId,
        }).pipe(
          Effect.map(
            (created) =>
              ({
                bundleIdentifier: created.bundleIdentifier,
                profileBase64: created.profileBase64,
                profileUuid: created.profileUuid,
              }) satisfies AutoProvisionedEntry,
          ),
          Effect.mapError((cause) => {
            const tag = hasTag(cause) ? cause._tag : "AutoProvisionError";
            const message =
              hasTag(cause) && typeof cause.message === "string"
                ? cause.message
                : `Failed to auto-provision profile for "${bundleIdentifier}" (${tag})`;
            return new MissingCredentialsError({
              message: `Auto-provision failed for "${bundleIdentifier}": ${message}`,
              hint: autoProvisionHint,
            });
          }),
        ),
      { concurrency: 2 },
    );
  });

const writeProfile = (
  fs: FileSystem.FileSystem,
  tempDir: string,
  params: {
    readonly bundleIdentifier: string;
    readonly base64: string;
    readonly uuid: string | null;
  },
): Effect.Effect<IosCredentialProfile, PlatformError> =>
  Effect.gen(function* () {
    const filenameBase = params.uuid ?? params.bundleIdentifier;
    const profileFilename = `${filenameBase}.mobileprovision`;
    const profilePath = path.join(tempDir, profileFilename);
    yield* fs.writeFile(profilePath, fromBase64(params.base64));
    return {
      bundleIdentifier: params.bundleIdentifier,
      profilePath,
      profileFilename,
    } satisfies IosCredentialProfile;
  });

export interface DownloadAndroidCredentialsOptions {
  readonly projectId: string;
  readonly applicationIdentifier: string;
  readonly tempDir: string;
  readonly buildProfile?: string | undefined;
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
  FileSystem.FileSystem | CliRuntime | IdentityStore | InteractiveMode
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const resolved = yield* api.buildCredentials
      .resolve({
        path: { projectId: options.projectId },
        payload: {
          platform: "android" as const,
          applicationIdentifier: options.applicationIdentifier,
          ...compact({ buildProfile: options.buildProfile }),
        },
      })
      .pipe(Effect.mapError((cause) => resolveErrorToMissingCredentials(cause, "android")));

    if (resolved.platform !== "android") {
      return yield* new MissingCredentialsError({
        message: "Server returned non-Android credentials for an Android build request",
        hint: androidBindHint,
      });
    }

    const session = yield* openVaultSessionForBuild(api, androidBindHint);
    const secret = yield* decryptResolveSecret({
      session,
      credentialType: "keystore",
      credentialId: resolved.keystore.id,
      envelope: resolved.keystore,
      fields: ["keystoreBase64", "keystorePassword", "keyPassword"],
      hint: androidBindHint,
    });

    const keystorePath = path.join(options.tempDir, "upload.keystore");
    yield* fs.writeFile(keystorePath, fromBase64(secret.keystoreBase64));

    return {
      keystorePath,
      storePassword: secret.keystorePassword,
      keyAlias: resolved.keystore.keyAlias,
      keyPassword: secret.keyPassword,
    };
  });
