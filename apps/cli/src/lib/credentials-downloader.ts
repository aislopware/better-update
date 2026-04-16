import path from "node:path";

import { FileSystem } from "@effect/platform";
import { Console, Effect } from "effect";

import type { PlatformError } from "@effect/platform/Error";

import { MissingCredentialsError } from "./exit-codes";
import { inspectKeystore, validateKeystoreAlias } from "./keystore-parser";
import { checkCertExpiry, inspectP12 } from "./pkcs12";

import type { ApiClient } from "../services/api-client";

// ── shared helpers ────────────────────────────────────────────────

interface DecodedCredential {
  readonly blob: Buffer;
  readonly password: string | null;
  readonly keyAlias: string | null;
  readonly keyPassword: string | null;
  readonly filename: string;
}

const downloadDecoded = (
  api: ApiClient,
  credentialId: string,
): Effect.Effect<DecodedCredential, unknown> =>
  api.credentials.download({ path: { id: credentialId } }).pipe(
    Effect.map((result) => ({
      blob: Buffer.from(result.blob, "base64"),
      password: result.password,
      keyAlias: result.keyAlias,
      keyPassword: result.keyPassword,
      filename: result.filename,
    })),
  );

const writeSecret = (
  fs: FileSystem.FileSystem,
  filePath: string,
  contents: Buffer,
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function* () {
    yield* fs.writeFile(filePath, contents);
    yield* fs.chmod(filePath, 0o600);
  });

const missingCertHint =
  "Upload one with `better-update credentials upload --platform ios --type distribution-certificate --file <cert.p12> --password <...>`.";
const missingProfileHintFor = (distribution: string): string =>
  `Upload one with \`better-update credentials upload --platform ios --type provisioning-profile --distribution ${distribution} --file <profile.mobileprovision>\`.`;
const missingKeystoreHint =
  "Upload one with `better-update credentials upload --platform android --type keystore --file <release.keystore> --password <...> --key-alias <...> --key-password <...>`.";

// ── iOS ───────────────────────────────────────────────────────────

export interface DownloadIosCredentialsOptions {
  readonly projectId: string;
  readonly distribution: string;
  readonly tempDir: string;
}

export interface IosCredentials {
  readonly p12Path: string;
  readonly p12Password: string;
  readonly profilePath: string;
  readonly profileFilename: string;
  readonly teamId?: string;
}

export const downloadIosCredentials = (
  api: ApiClient,
  { projectId, distribution, tempDir }: DownloadIosCredentialsOptions,
): Effect.Effect<IosCredentials, MissingCredentialsError | PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    // 1. Distribution certificate
    const certList = yield* api.credentials
      .list({
        urlParams: { projectId, platform: "ios", type: "distribution-certificate" },
      })
      .pipe(
        Effect.mapError(
          () =>
            new MissingCredentialsError({
              message: "Failed to list iOS distribution certificates.",
              hint: missingCertHint,
            }),
        ),
      );

    const cert = certList.items.find((c) => c.isActive);
    if (!cert) {
      return yield* new MissingCredentialsError({
        message: "No active iOS distribution certificate found for this project.",
        hint: missingCertHint,
      });
    }

    const certDownload = yield* downloadDecoded(api, cert.id).pipe(
      Effect.mapError(
        () =>
          new MissingCredentialsError({
            message: `Failed to download iOS distribution certificate ${cert.id}.`,
            hint: "Check that the credential exists and that your account has access.",
          }),
      ),
    );

    const p12Path = path.join(tempDir, "cert.p12");
    yield* writeSecret(fs, p12Path, certDownload.blob);

    // Validate downloaded certificate
    yield* inspectP12({ data: certDownload.blob, password: certDownload.password ?? "" }).pipe(
      Effect.tap((info) =>
        Effect.gen(function* () {
          yield* Console.log(`  Signing identity: ${info.signingIdentity}`);
          const warning = checkCertExpiry(info.expiresAt, "Distribution certificate");
          if (warning) yield* Console.warn(warning);
        }),
      ),
      Effect.catchAll(() => Effect.void),
    );

    // 2. Provisioning profile (filtered by distribution)
    const profileList = yield* api.credentials
      .list({
        urlParams: {
          projectId,
          platform: "ios",
          type: "provisioning-profile",
          distribution,
        },
      })
      .pipe(
        Effect.mapError(
          () =>
            new MissingCredentialsError({
              message: "Failed to list iOS provisioning profiles.",
              hint: missingProfileHintFor(distribution),
            }),
        ),
      );

    const profile = profileList.items.find((c) => c.isActive);
    if (!profile) {
      return yield* new MissingCredentialsError({
        message: `No active iOS provisioning profile found for distribution "${distribution}".`,
        hint: missingProfileHintFor(distribution),
      });
    }

    const profileDownload = yield* downloadDecoded(api, profile.id).pipe(
      Effect.mapError(
        () =>
          new MissingCredentialsError({
            message: `Failed to download iOS provisioning profile ${profile.id}.`,
            hint: "Check that the credential exists and that your account has access.",
          }),
      ),
    );

    const profilePath = path.join(tempDir, "profile.mobileprovision");
    yield* writeSecret(fs, profilePath, profileDownload.blob);

    return {
      p12Path,
      p12Password: certDownload.password ?? "",
      profilePath,
      profileFilename: profileDownload.filename,
    };
  });

// ── Android ───────────────────────────────────────────────────────

export interface DownloadAndroidCredentialsOptions {
  readonly projectId: string;
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
  { projectId, tempDir }: DownloadAndroidCredentialsOptions,
): Effect.Effect<
  AndroidCredentials,
  MissingCredentialsError | PlatformError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const keystoreList = yield* api.credentials
      .list({
        urlParams: { projectId, platform: "android", type: "keystore" },
      })
      .pipe(
        Effect.mapError(
          () =>
            new MissingCredentialsError({
              message: "Failed to list Android keystores.",
              hint: missingKeystoreHint,
            }),
        ),
      );

    const keystore = keystoreList.items.find((c) => c.isActive);
    if (!keystore) {
      return yield* new MissingCredentialsError({
        message: "No active Android keystore found for this project.",
        hint: missingKeystoreHint,
      });
    }

    const keystoreDownload = yield* downloadDecoded(api, keystore.id).pipe(
      Effect.mapError(
        () =>
          new MissingCredentialsError({
            message: `Failed to download Android keystore ${keystore.id}.`,
            hint: "Check that the credential exists and that your account has access.",
          }),
      ),
    );

    if (
      keystoreDownload.password === null ||
      keystoreDownload.keyAlias === null ||
      keystoreDownload.keyPassword === null
    ) {
      return yield* new MissingCredentialsError({
        message: "Android keystore is missing password, keyAlias, or keyPassword.",
        hint: "Re-upload with `--password <...> --key-alias <...> --key-password <...>`.",
      });
    }

    const keystorePath = path.join(tempDir, "release.keystore");
    yield* writeSecret(fs, keystorePath, keystoreDownload.blob);

    // Validate downloaded keystore
    yield* inspectKeystore({
      data: keystoreDownload.blob,
      password: keystoreDownload.password,
    }).pipe(
      Effect.tap((info) =>
        Effect.gen(function* () {
          yield* Console.log(`  Keystore aliases: ${info.aliases.join(", ")}`);
          const aliasWarning = validateKeystoreAlias(info, keystoreDownload.keyAlias!);
          if (aliasWarning) yield* Console.warn(aliasWarning);
          // Check certificate expiry for the signing key
          const entry = info.entries.find((e) => e.alias === keystoreDownload.keyAlias);
          if (entry?.expiresAt) {
            const expiryWarning = checkCertExpiry(
              entry.expiresAt,
              `Keystore certificate "${keystoreDownload.keyAlias}"`,
            );
            if (expiryWarning) yield* Console.warn(expiryWarning);
          }
        }),
      ),
      Effect.catchAll(() => Effect.void),
    );

    return {
      keystorePath,
      storePassword: keystoreDownload.password,
      keyAlias: keystoreDownload.keyAlias,
      keyPassword: keystoreDownload.keyPassword,
    };
  });
