import path from "node:path";

import { asRecord, compact } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { CredentialsJsonError } from "./exit-codes";

export interface IosDistributionCertificateEntry {
  readonly path: string;
  readonly password: string;
}

export interface IosPushKeyEntry {
  readonly path: string;
  readonly keyId: string;
  readonly teamId: string;
}

export interface IosAscApiKeyEntry {
  readonly path: string;
  readonly keyId: string;
  readonly issuerId: string;
}

export interface IosAdditionalProvisioningProfileEntry {
  /** Bundle identifier the profile is issued for (e.g. `com.example.app.notification`). */
  readonly bundleIdentifier: string;
  readonly path: string;
}

export interface IosCredentialsEntry {
  /** Profile for the main app target. Bundle ID is inferred from the Expo config at load time. */
  readonly provisioningProfilePath: string;
  /**
   * Extra profiles for non-main signed targets (app extensions: notification
   * service, share, action, etc.). Each entry must declare its own bundle ID.
   */
  readonly additionalProvisioningProfiles?: readonly IosAdditionalProvisioningProfileEntry[];
  readonly distributionCertificate: IosDistributionCertificateEntry;
  readonly pushKey?: IosPushKeyEntry;
  readonly ascApiKey?: IosAscApiKeyEntry;
}

export interface AndroidKeystoreEntry {
  readonly keystorePath: string;
  readonly keystorePassword: string;
  readonly keyAlias: string;
  readonly keyPassword: string;
}

export interface AndroidGoogleServiceAccountEntry {
  readonly path: string;
}

export interface AndroidCredentialsEntry {
  readonly keystore: AndroidKeystoreEntry;
  readonly googleServiceAccountKey?: AndroidGoogleServiceAccountEntry;
}

export interface CredentialsJson {
  readonly ios?: IosCredentialsEntry;
  readonly android?: AndroidCredentialsEntry;
}

export const CREDENTIALS_JSON_FILENAME = "credentials.json";

const asString = (value: unknown, field: string): Effect.Effect<string, CredentialsJsonError> =>
  typeof value === "string" && value.length > 0
    ? Effect.succeed(value)
    : Effect.fail(
        new CredentialsJsonError({
          message: `credentials.json: field "${field}" must be a non-empty string.`,
        }),
      );

const parseIosDistributionCertificate = (
  raw: unknown,
): Effect.Effect<IosDistributionCertificateEntry, CredentialsJsonError> =>
  Effect.gen(function* () {
    const record = asRecord(raw);
    if (!record) {
      return yield* new CredentialsJsonError({
        message: "credentials.json: ios.distributionCertificate must be an object.",
      });
    }
    return {
      path: yield* asString(record["path"], "ios.distributionCertificate.path"),
      password: yield* asString(record["password"], "ios.distributionCertificate.password"),
    } satisfies IosDistributionCertificateEntry;
  });

const parseIosPushKey = (raw: unknown): Effect.Effect<IosPushKeyEntry, CredentialsJsonError> =>
  Effect.gen(function* () {
    const record = asRecord(raw);
    if (!record) {
      return yield* new CredentialsJsonError({
        message: "credentials.json: ios.pushKey must be an object.",
      });
    }
    return {
      path: yield* asString(record["path"], "ios.pushKey.path"),
      keyId: yield* asString(record["keyId"], "ios.pushKey.keyId"),
      teamId: yield* asString(record["teamId"], "ios.pushKey.teamId"),
    } satisfies IosPushKeyEntry;
  });

const parseIosAscApiKey = (raw: unknown): Effect.Effect<IosAscApiKeyEntry, CredentialsJsonError> =>
  Effect.gen(function* () {
    const record = asRecord(raw);
    if (!record) {
      return yield* new CredentialsJsonError({
        message: "credentials.json: ios.ascApiKey must be an object.",
      });
    }
    return {
      path: yield* asString(record["path"], "ios.ascApiKey.path"),
      keyId: yield* asString(record["keyId"], "ios.ascApiKey.keyId"),
      issuerId: yield* asString(record["issuerId"], "ios.ascApiKey.issuerId"),
    } satisfies IosAscApiKeyEntry;
  });

const parseIosAdditionalProvisioningProfile = (
  raw: unknown,
  index: number,
): Effect.Effect<IosAdditionalProvisioningProfileEntry, CredentialsJsonError> =>
  Effect.gen(function* () {
    const record = asRecord(raw);
    if (!record) {
      return yield* new CredentialsJsonError({
        message: `credentials.json: ios.additionalProvisioningProfiles[${index}] must be an object.`,
      });
    }
    return {
      bundleIdentifier: yield* asString(
        record["bundleIdentifier"],
        `ios.additionalProvisioningProfiles[${index}].bundleIdentifier`,
      ),
      path: yield* asString(record["path"], `ios.additionalProvisioningProfiles[${index}].path`),
    } satisfies IosAdditionalProvisioningProfileEntry;
  });

const parseIosAdditionalProvisioningProfiles = (
  raw: unknown,
): Effect.Effect<readonly IosAdditionalProvisioningProfileEntry[], CredentialsJsonError> =>
  Effect.gen(function* () {
    if (!Array.isArray(raw)) {
      return yield* new CredentialsJsonError({
        message: "credentials.json: ios.additionalProvisioningProfiles must be an array.",
      });
    }
    const entries: IosAdditionalProvisioningProfileEntry[] = [];
    for (const [index, item] of raw.entries()) {
      entries.push(yield* parseIosAdditionalProvisioningProfile(item, index));
    }
    return entries;
  });

const parseIos = (raw: unknown): Effect.Effect<IosCredentialsEntry, CredentialsJsonError> =>
  Effect.gen(function* () {
    const record = asRecord(raw);
    if (!record) {
      return yield* new CredentialsJsonError({
        message: 'credentials.json: "ios" must be an object.',
      });
    }
    const provisioningProfilePath = yield* asString(
      record["provisioningProfilePath"],
      "ios.provisioningProfilePath",
    );
    const distributionCertificate = yield* parseIosDistributionCertificate(
      record["distributionCertificate"],
    );
    const additionalProvisioningProfiles =
      record["additionalProvisioningProfiles"] === undefined
        ? undefined
        : yield* parseIosAdditionalProvisioningProfiles(record["additionalProvisioningProfiles"]);
    const pushKey =
      record["pushKey"] === undefined ? undefined : yield* parseIosPushKey(record["pushKey"]);
    const ascApiKey =
      record["ascApiKey"] === undefined ? undefined : yield* parseIosAscApiKey(record["ascApiKey"]);
    return {
      provisioningProfilePath,
      distributionCertificate,
      ...compact({ additionalProvisioningProfiles, pushKey, ascApiKey }),
    } satisfies IosCredentialsEntry;
  });

const parseAndroidKeystore = (
  raw: unknown,
): Effect.Effect<AndroidKeystoreEntry, CredentialsJsonError> =>
  Effect.gen(function* () {
    const record = asRecord(raw);
    if (!record) {
      return yield* new CredentialsJsonError({
        message: "credentials.json: android.keystore must be an object.",
      });
    }
    return {
      keystorePath: yield* asString(record["keystorePath"], "android.keystore.keystorePath"),
      keystorePassword: yield* asString(
        record["keystorePassword"],
        "android.keystore.keystorePassword",
      ),
      keyAlias: yield* asString(record["keyAlias"], "android.keystore.keyAlias"),
      keyPassword: yield* asString(record["keyPassword"], "android.keystore.keyPassword"),
    } satisfies AndroidKeystoreEntry;
  });

const parseGoogleServiceAccountKey = (
  raw: unknown,
): Effect.Effect<AndroidGoogleServiceAccountEntry, CredentialsJsonError> =>
  Effect.gen(function* () {
    const record = asRecord(raw);
    if (!record) {
      return yield* new CredentialsJsonError({
        message: "credentials.json: android.googleServiceAccountKey must be an object.",
      });
    }
    return {
      path: yield* asString(record["path"], "android.googleServiceAccountKey.path"),
    } satisfies AndroidGoogleServiceAccountEntry;
  });

const parseAndroid = (raw: unknown): Effect.Effect<AndroidCredentialsEntry, CredentialsJsonError> =>
  Effect.gen(function* () {
    const record = asRecord(raw);
    if (!record) {
      return yield* new CredentialsJsonError({
        message: 'credentials.json: "android" must be an object.',
      });
    }
    const keystore = yield* parseAndroidKeystore(record["keystore"]);
    const googleServiceAccountKey =
      record["googleServiceAccountKey"] === undefined
        ? undefined
        : yield* parseGoogleServiceAccountKey(record["googleServiceAccountKey"]);
    return {
      keystore,
      ...compact({ googleServiceAccountKey }),
    } satisfies AndroidCredentialsEntry;
  });

export const parseCredentialsJson = (
  raw: string,
): Effect.Effect<CredentialsJson, CredentialsJsonError> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: (): unknown => JSON.parse(raw),
      catch: () => new CredentialsJsonError({ message: "credentials.json is not valid JSON." }),
    });
    const root = asRecord(parsed);
    if (!root) {
      return yield* new CredentialsJsonError({
        message: "credentials.json must be a JSON object at the top level.",
      });
    }
    const ios = root["ios"] === undefined ? undefined : yield* parseIos(root["ios"]);
    const android =
      root["android"] === undefined ? undefined : yield* parseAndroid(root["android"]);
    if (!ios && !android) {
      return yield* new CredentialsJsonError({
        message: 'credentials.json must contain at least one of "ios" or "android".',
      });
    }
    return compact({ ios, android }) satisfies CredentialsJson;
  });

export const credentialsJsonPath = (projectRoot: string): string =>
  path.join(projectRoot, CREDENTIALS_JSON_FILENAME);

export const readCredentialsJson = (
  projectRoot: string,
): Effect.Effect<CredentialsJson, CredentialsJsonError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const filePath = credentialsJsonPath(projectRoot);
    const exists = yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));
    if (!exists) {
      return yield* new CredentialsJsonError({
        message: `credentials.json not found at ${filePath}.`,
      });
    }
    const raw = yield* fs.readFileString(filePath).pipe(
      Effect.mapError(
        (cause) =>
          new CredentialsJsonError({
            message: `Failed to read credentials.json: ${String(cause)}`,
          }),
      ),
    );
    return yield* parseCredentialsJson(raw);
  });

export const writeCredentialsJson = (
  projectRoot: string,
  data: CredentialsJson,
): Effect.Effect<string, CredentialsJsonError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const filePath = credentialsJsonPath(projectRoot);
    const body = `${JSON.stringify(data, null, 2)}\n`;
    yield* fs.writeFileString(filePath, body).pipe(
      Effect.mapError(
        (cause) =>
          new CredentialsJsonError({
            message: `Failed to write credentials.json: ${String(cause)}`,
          }),
      ),
    );
    return filePath;
  });

/**
 * Resolve a path that may be either absolute or relative to the project root.
 */
export const resolveCredentialPath = (projectRoot: string, candidate: string): string =>
  path.isAbsolute(candidate) ? candidate : path.join(projectRoot, candidate);
