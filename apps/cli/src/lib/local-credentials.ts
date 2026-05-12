import path from "node:path";

import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { readCredentialsJson, resolveCredentialPath } from "./credentials-json";
import { MissingCredentialsError } from "./exit-codes";

import type { AndroidCredentials, IosCredentials } from "./credentials-downloader";

const requirePath = (
  fs: FileSystem.FileSystem,
  absolutePath: string,
  label: string,
): Effect.Effect<void, MissingCredentialsError> =>
  fs.exists(absolutePath).pipe(
    Effect.catchAll(() => Effect.succeed(false)),
    Effect.flatMap((exists) =>
      exists
        ? Effect.void
        : Effect.fail(
            new MissingCredentialsError({
              message: `Local credentials.json: ${label} not found at ${absolutePath}.`,
              hint: "Run `better-update credentials sync pull` to materialize files, or fix the path in credentials.json.",
            }),
          ),
    ),
  );

export interface LoadLocalIosCredentialsOptions {
  readonly projectRoot: string;
}

export const loadLocalIosCredentials = (
  options: LoadLocalIosCredentialsOptions,
): Effect.Effect<IosCredentials, MissingCredentialsError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const data = yield* readCredentialsJson(options.projectRoot).pipe(
      Effect.mapError(
        (cause) =>
          new MissingCredentialsError({
            message: `Local credentials.json: ${cause.message}`,
            hint: 'Create credentials.json or switch the build profile\'s credentialsSource back to "remote".',
          }),
      ),
    );
    if (!data.ios) {
      return yield* new MissingCredentialsError({
        message: "credentials.json has no `ios` section but the build is for iOS.",
        hint: "Add an `ios` block to credentials.json or switch credentialsSource to remote.",
      });
    }
    const p12Path = resolveCredentialPath(
      options.projectRoot,
      data.ios.distributionCertificate.path,
    );
    const profilePath = resolveCredentialPath(
      options.projectRoot,
      data.ios.provisioningProfilePath,
    );
    yield* requirePath(fs, p12Path, "distribution certificate (.p12)");
    yield* requirePath(fs, profilePath, "provisioning profile (.mobileprovision)");
    return {
      p12Path,
      p12Password: data.ios.distributionCertificate.password,
      profilePath,
      profileFilename: path.basename(profilePath),
      teamId: "",
    };
  });

export interface LoadLocalAndroidCredentialsOptions {
  readonly projectRoot: string;
}

export const loadLocalAndroidCredentials = (
  options: LoadLocalAndroidCredentialsOptions,
): Effect.Effect<AndroidCredentials, MissingCredentialsError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const data = yield* readCredentialsJson(options.projectRoot).pipe(
      Effect.mapError(
        (cause) =>
          new MissingCredentialsError({
            message: `Local credentials.json: ${cause.message}`,
            hint: 'Create credentials.json or switch the build profile\'s credentialsSource back to "remote".',
          }),
      ),
    );
    if (!data.android) {
      return yield* new MissingCredentialsError({
        message: "credentials.json has no `android` section but the build is for Android.",
        hint: "Add an `android` block to credentials.json or switch credentialsSource to remote.",
      });
    }
    const keystorePath = resolveCredentialPath(
      options.projectRoot,
      data.android.keystore.keystorePath,
    );
    yield* requirePath(fs, keystorePath, "keystore");
    return {
      keystorePath,
      storePassword: data.android.keystore.keystorePassword,
      keyAlias: data.android.keystore.keyAlias,
      keyPassword: data.android.keystore.keyPassword,
    };
  });
