import { createHash } from "node:crypto";
import path from "node:path";

import { fromBase64, toBase64 } from "@better-update/encoding";
import { FileSystem } from "@effect/platform";
import { Data, Effect } from "effect";

import { generateAndroidKeystore } from "./android-keystore";
import {
  createBundleId,
  createCertificate,
  createProvisioningProfile,
  deleteCertificate,
  isCertificateLimitError,
  listBundleIds,
  listCertificates,
  listDevices,
} from "./apple-asc-client";
import { buildDistributionCertP12 } from "./apple-cert-to-p12";
import { generateCertificateSigningRequest } from "./apple-csr";
import { acquireBuildTempDir } from "./temp-dir";

import type { ApiClient } from "../services/api-client";
import type {
  AscCertificateType,
  AscCredentials,
  AscError,
  AscProfileType,
} from "./apple-asc-client";

type DistributionType = "APP_STORE" | "AD_HOC" | "DEVELOPMENT" | "ENTERPRISE";

const DISTRIBUTION_TO_PROFILE_TYPE: Record<DistributionType, AscProfileType> = {
  APP_STORE: "IOS_APP_STORE",
  AD_HOC: "IOS_APP_ADHOC",
  DEVELOPMENT: "IOS_APP_DEVELOPMENT",
  ENTERPRISE: "IOS_APP_INHOUSE",
};

export const computeDeviceRosterHashHex = (ascDeviceIds: readonly string[]): string => {
  const sorted = [...ascDeviceIds].toSorted();
  return createHash("sha256").update(sorted.join(","), "utf8").digest("hex");
};

export class CertificateLimitError extends Data.TaggedError("CertificateLimitError")<{
  readonly message: string;
}> {}

export class GenerateFailedError extends Data.TaggedError("GenerateFailedError")<{
  readonly step: string;
  readonly message: string;
}> {}

const messageForAscCause = (cause: AscError): string => {
  if (cause._tag === "AscApiError") {
    return cause.message;
  }
  if (cause._tag === "AppleAuthError") {
    return "Apple JWT signing failed";
  }
  return "Network error talking to Apple";
};

const wrapAscError = (step: string) => (cause: AscError) => {
  if (cause._tag === "AscApiError" && isCertificateLimitError(cause)) {
    return new CertificateLimitError({ message: cause.message });
  }
  return new GenerateFailedError({ step, message: messageForAscCause(cause) });
};

// ── Android keystore ───────────────────────────────────────────────

export interface GenerateAndUploadKeystoreInput {
  readonly keyAlias: string;
  readonly storePassword: string;
  readonly keyPassword: string;
  readonly commonName: string;
  readonly organization: string;
  readonly validityDays?: number;
}

export const generateAndUploadKeystore = (api: ApiClient, input: GenerateAndUploadKeystoreInput) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const tempDir = yield* acquireBuildTempDir;
      const keystorePath = path.join(tempDir, "release.keystore");

      yield* generateAndroidKeystore({
        outputPath: keystorePath,
        keyAlias: input.keyAlias,
        storePassword: input.storePassword,
        keyPassword: input.keyPassword,
        commonName: input.commonName,
        organization: input.organization,
        ...(input.validityDays === undefined ? {} : { validityDays: input.validityDays }),
      });

      const bytes = yield* fs.readFile(keystorePath);
      const created = yield* api.androidUploadKeystores.upload({
        payload: {
          keystoreBase64: toBase64(bytes),
          keyAlias: input.keyAlias,
          keystorePassword: input.storePassword,
          keyPassword: input.keyPassword,
        },
      });
      return { id: created.id, keyAlias: created.keyAlias };
    }),
  );

// ── ASC credentials fetcher ────────────────────────────────────────

export const fetchAscCredentials = (api: ApiClient, ascApiKeyId: string) =>
  api.ascApiKeys.getCredentials({ path: { id: ascApiKeyId } });

// ── iOS distribution certificate ───────────────────────────────────

export interface GenerateAndUploadDistributionCertificateInput {
  readonly ascApiKeyId: string;
  readonly certificateType?: "IOS_DISTRIBUTION" | "IOS_DEVELOPMENT";
}

export const generateAndUploadDistributionCertificate = (
  api: ApiClient,
  input: GenerateAndUploadDistributionCertificateInput,
) =>
  Effect.gen(function* () {
    const creds = yield* fetchAscCredentials(api, input.ascApiKeyId);
    const ascCreds = { keyId: creds.keyId, issuerId: creds.issuerId, p8Pem: creds.p8Pem };

    const csrResult = yield* Effect.tryPromise({
      try: generateCertificateSigningRequest,
      catch: (cause) =>
        new GenerateFailedError({
          step: "csr",
          message: `CSR generation failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });

    const certificateType = input.certificateType ?? "IOS_DISTRIBUTION";
    const apple = yield* createCertificate(ascCreds, {
      csrPem: csrResult.csrPem,
      certificateType,
    }).pipe(Effect.mapError(wrapAscError("apple-create-certificate")));

    if (apple.certificateContent === null) {
      return yield* Effect.fail(
        new GenerateFailedError({
          step: "apple-create-certificate",
          message: "Apple response missing certificateContent",
        }),
      );
    }

    const bundle = yield* buildDistributionCertP12({
      certificateContentBase64: apple.certificateContent,
      privateKey: csrResult.privateKey,
    }).pipe(
      Effect.mapError(
        (cause) => new GenerateFailedError({ step: "p12-build", message: cause.message }),
      ),
    );

    const created = yield* api.appleDistributionCertificates.upload({
      payload: {
        p12Base64: bundle.p12Base64,
        p12Password: bundle.password,
        serialNumber: bundle.metadata.serialNumber,
        appleTeamIdentifier: bundle.metadata.appleTeamId,
        ...(bundle.metadata.appleTeamName === null
          ? {}
          : { appleTeamName: bundle.metadata.appleTeamName }),
        ...(bundle.metadata.developerIdIdentifier === null
          ? {}
          : { developerIdIdentifier: bundle.metadata.developerIdIdentifier }),
        validFrom: bundle.metadata.validFrom,
        validUntil: bundle.metadata.validUntil,
      },
    });

    return {
      id: created.id,
      serialNumber: bundle.metadata.serialNumber,
      appleTeamId: created.appleTeamId,
      appleTeamIdentifier: bundle.metadata.appleTeamId,
      developerPortalIdentifier: apple.id,
    };
  });

export const revokeAppleCertificate = (
  api: ApiClient,
  input: { readonly ascApiKeyId: string; readonly developerPortalIdentifier: string },
) =>
  Effect.gen(function* () {
    const creds = yield* fetchAscCredentials(api, input.ascApiKeyId);
    yield* deleteCertificate(
      { keyId: creds.keyId, issuerId: creds.issuerId, p8Pem: creds.p8Pem },
      input.developerPortalIdentifier,
    ).pipe(Effect.mapError(wrapAscError("apple-revoke-certificate")));
  });

export interface RevokeLocalDistributionCertificateInput {
  readonly ascApiKeyId: string;
  readonly distributionCertificateId: string;
  readonly keepLocal?: boolean;
}

export interface RevokeLocalDistributionCertificateResult {
  readonly localId: string;
  readonly serialNumber: string;
  readonly revokedOnApple: boolean;
  readonly deletedLocally: boolean;
}

export const revokeLocalDistributionCertificate = (
  api: ApiClient,
  input: RevokeLocalDistributionCertificateInput,
) =>
  Effect.gen(function* () {
    const listing = yield* api.appleDistributionCertificates.list();
    const local = listing.items.find((entry) => entry.id === input.distributionCertificateId);
    if (local === undefined) {
      return yield* Effect.fail(
        new GenerateFailedError({
          step: "load-distribution-certificate",
          message: `Distribution certificate ${input.distributionCertificateId} not found on this account`,
        }),
      );
    }

    const creds = yield* fetchAscCredentials(api, input.ascApiKeyId);
    const ascCreds = { keyId: creds.keyId, issuerId: creds.issuerId, p8Pem: creds.p8Pem };
    const targetSerial = local.serialNumber.toUpperCase();

    const matching = yield* Effect.all(
      [
        listCertificates(ascCreds, { certificateType: "IOS_DISTRIBUTION" }),
        listCertificates(ascCreds, { certificateType: "IOS_DEVELOPMENT" }),
      ],
      { concurrency: 2 },
    ).pipe(Effect.mapError(wrapAscError("apple-list-certificates")));

    const ascMatch = [...matching[0], ...matching[1]].find(
      (entry) => entry.serialNumber.toUpperCase() === targetSerial,
    );

    let revokedOnApple = false;
    if (ascMatch !== undefined) {
      yield* deleteCertificate(ascCreds, ascMatch.id).pipe(
        Effect.mapError(wrapAscError("apple-revoke-certificate")),
      );
      revokedOnApple = true;
    }

    let deletedLocally = false;
    if (input.keepLocal !== true) {
      yield* api.appleDistributionCertificates.delete({
        path: { id: input.distributionCertificateId },
      });
      deletedLocally = true;
    }

    return {
      localId: input.distributionCertificateId,
      serialNumber: local.serialNumber,
      revokedOnApple,
      deletedLocally,
    } satisfies RevokeLocalDistributionCertificateResult;
  });

export const listAppleCertificates = (
  api: ApiClient,
  input: {
    readonly ascApiKeyId: string;
    readonly certificateType?: AscCertificateType;
  },
) =>
  Effect.gen(function* () {
    const creds = yield* fetchAscCredentials(api, input.ascApiKeyId);
    return yield* listCertificates(
      { keyId: creds.keyId, issuerId: creds.issuerId, p8Pem: creds.p8Pem },
      input.certificateType === undefined ? {} : { certificateType: input.certificateType },
    ).pipe(Effect.mapError(wrapAscError("apple-list-certificates")));
  });

// ── iOS provisioning profile ───────────────────────────────────────

export interface GenerateAndUploadProvisioningProfileInput {
  readonly ascApiKeyId: string;
  readonly distributionCertificateId: string;
  readonly bundleIdentifier: string;
  readonly distributionType: DistributionType;
  readonly deviceIds?: readonly string[];
}

const resolveCertAscId = (
  creds: AscCredentials,
  serialNumber: string,
  certificateType: AscCertificateType,
) =>
  Effect.gen(function* () {
    const certs = yield* listCertificates(creds, { certificateType }).pipe(
      Effect.mapError(wrapAscError("apple-list-certificates")),
    );
    const match = certs.find((entry) => entry.serialNumber.toUpperCase() === serialNumber);
    if (match === undefined) {
      return yield* Effect.fail(
        new GenerateFailedError({
          step: "match-apple-certificate",
          message: `Distribution certificate ${serialNumber} not present on Apple Developer Portal; upload or re-generate it`,
        }),
      );
    }
    return match.id;
  });

const ensureBundleId = (creds: AscCredentials, bundleIdentifier: string) =>
  Effect.gen(function* () {
    const bundles = yield* listBundleIds(creds).pipe(
      Effect.mapError(wrapAscError("apple-list-bundle-ids")),
    );
    const existing = bundles.find((entry) => entry.identifier === bundleIdentifier);
    if (existing !== undefined) {
      return existing.id;
    }
    const created = yield* createBundleId(creds, {
      identifier: bundleIdentifier,
      name: bundleIdentifier,
    }).pipe(Effect.mapError(wrapAscError("apple-create-bundle-id")));
    return created.id;
  });

const collectDeviceAscIds = (
  creds: AscCredentials,
  appleTeamId: string,
  deviceIds: readonly string[] | undefined,
) =>
  Effect.gen(function* () {
    const devices = yield* listDevices(creds).pipe(
      Effect.mapError(wrapAscError("apple-list-devices")),
    );
    const ids =
      deviceIds === undefined
        ? devices.map((device) => device.id)
        : devices.filter((device) => new Set(deviceIds).has(device.id)).map((device) => device.id);
    return { ids, appleTeamId };
  });

export const generateAndUploadProvisioningProfile = (
  api: ApiClient,
  input: GenerateAndUploadProvisioningProfileInput,
) =>
  Effect.gen(function* () {
    const creds = yield* fetchAscCredentials(api, input.ascApiKeyId);
    const ascCreds: AscCredentials = {
      keyId: creds.keyId,
      issuerId: creds.issuerId,
      p8Pem: creds.p8Pem,
    };

    const cert = yield* api.appleDistributionCertificates.list().pipe(
      Effect.map(({ items }) => items.find((item) => item.id === input.distributionCertificateId)),
      Effect.flatMap((match) =>
        match === undefined
          ? Effect.fail(
              new GenerateFailedError({
                step: "load-distribution-certificate",
                message: `Distribution certificate ${input.distributionCertificateId} not found`,
              }),
            )
          : Effect.succeed(match),
      ),
    );

    const certificateType: AscCertificateType =
      input.distributionType === "DEVELOPMENT" ? "IOS_DEVELOPMENT" : "IOS_DISTRIBUTION";

    const [certAscId, bundleIdAscId] = yield* Effect.all(
      [
        resolveCertAscId(ascCreds, cert.serialNumber.toUpperCase(), certificateType),
        ensureBundleId(ascCreds, input.bundleIdentifier),
      ],
      { concurrency: 2 },
    );

    const useDevices =
      input.distributionType === "AD_HOC" || input.distributionType === "DEVELOPMENT";

    const { ids: deviceAscIds } = useDevices
      ? yield* collectDeviceAscIds(ascCreds, cert.appleTeamId, input.deviceIds)
      : { ids: [] as readonly string[] };

    if (useDevices && deviceAscIds.length === 0) {
      return yield* Effect.fail(
        new GenerateFailedError({
          step: "collect-devices",
          message: "No registered devices to attach to the provisioning profile",
        }),
      );
    }

    const profileName = `${input.bundleIdentifier} ${input.distributionType} ${Date.now()}`;
    const profile = yield* createProvisioningProfile(ascCreds, {
      profileName,
      profileType: DISTRIBUTION_TO_PROFILE_TYPE[input.distributionType],
      bundleIdAscId,
      certificateAscIds: [certAscId],
      deviceAscIds,
    }).pipe(Effect.mapError(wrapAscError("apple-create-profile")));

    const profileBytes = fromBase64(profile.profileContent);
    const rosterHash = useDevices ? computeDeviceRosterHashHex(deviceAscIds) : undefined;

    const created = yield* api.appleProvisioningProfiles.upload({
      payload: {
        profileBase64: toBase64(profileBytes),
        appleDistributionCertificateId: input.distributionCertificateId,
        isManaged: true,
        ...(rosterHash === undefined ? {} : { deviceRosterHash: rosterHash }),
      },
    });

    return {
      id: created.id,
      bundleIdentifier: created.bundleIdentifier,
      distributionType: created.distributionType,
      profileName: created.profileName,
      validUntil: created.validUntil,
      developerPortalIdentifier: created.developerPortalIdentifier,
    };
  });
