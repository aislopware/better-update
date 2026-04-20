import { fromBase64 } from "@better-update/encoding";
import { Effect } from "effect";

import { AppleAppStoreConnect } from "../cloudflare/apple-app-store-connect";
import { cloudflareEnv } from "../cloudflare/context";
import { Vault } from "../cloudflare/vault";
import { BadRequest, NotFound } from "../errors";
import { withR2Compensation } from "../lib/r2-helpers";
import { AppleDistributionCertificateRepo } from "../repositories/apple-distribution-certificates";
import { AppleProvisioningProfileRepo } from "../repositories/apple-provisioning-profiles";
import { AppleTeamRepo } from "../repositories/apple-teams";
import { AscApiKeyRepo } from "../repositories/asc-api-keys";
import { DeviceRepo } from "../repositories/devices";

import type { AppleCredentials, AppleProfileType } from "../cloudflare/apple-app-store-connect";
import type { AscApiKeyModel, DistributionType } from "../models";

export interface GenerateProvisioningProfileParams {
  readonly organizationId: string;
  readonly ascApiKeyId: string;
  readonly appleDistributionCertificateId: string;
  readonly bundleIdentifier: string;
  readonly distributionType: DistributionType;
  readonly deviceIds?: readonly string[];
}

const toProfileType = (value: DistributionType): AppleProfileType => {
  if (value === "APP_STORE") {
    return "IOS_APP_STORE";
  }
  if (value === "AD_HOC") {
    return "IOS_APP_ADHOC";
  }
  if (value === "DEVELOPMENT") {
    return "IOS_APP_DEVELOPMENT";
  }
  return "IOS_APP_INHOUSE";
};

const decryptFailure = () => new BadRequest({ message: "Decryption failed" });

const mapAppleError = (error: { _tag: string; message?: string }) =>
  new BadRequest({
    message:
      error._tag === "AppleApiError"
        ? `Apple: ${error.message ?? "API error"}`
        : `Apple: ${error._tag}`,
  });

const loadAscCredentials = (organizationId: string, ascKey: AscApiKeyModel, teamAppleId: string) =>
  Effect.gen(function* () {
    const env = yield* cloudflareEnv;
    const vault = yield* Vault;
    const issuerId = yield* vault
      .decryptSecret({
        organizationId,
        keyVersion: ascKey.issuerIdKeyVersion,
        encrypted: ascKey.issuerIdEncrypted,
      })
      .pipe(Effect.mapError(decryptFailure));
    const p8Blob = yield* Effect.promise(async () => env.CREDENTIAL_ARTIFACTS.get(ascKey.r2Key));
    if (p8Blob === null) {
      return yield* Effect.fail(new NotFound({ message: "ASC API key artifact missing" }));
    }
    const p8Encrypted = new Uint8Array(yield* Effect.promise(async () => p8Blob.arrayBuffer()));
    const p8Bytes = yield* vault
      .envelopeDecrypt({
        organizationId,
        keyVersion: ascKey.dekKeyVersion,
        encryptedDek: ascKey.encryptedDek,
        encryptedBlob: p8Encrypted,
      })
      .pipe(Effect.mapError(decryptFailure));
    const credentials: AppleCredentials = {
      teamIdentifier: teamAppleId,
      keyId: ascKey.keyId,
      issuerId,
      p8Pem: new TextDecoder().decode(p8Bytes),
    };
    return credentials;
  });

const ensureBundleId = (credentials: AppleCredentials, bundleIdentifier: string, jwt: string) =>
  Effect.gen(function* () {
    const apple = yield* AppleAppStoreConnect;
    const bundles = yield* apple
      .listBundleIds(credentials, { jwt })
      .pipe(Effect.mapError(mapAppleError));
    const existing = bundles.find((entry) => entry.identifier === bundleIdentifier);
    if (existing !== undefined) {
      return existing;
    }
    return yield* apple
      .createBundleId(
        credentials,
        { identifier: bundleIdentifier, name: bundleIdentifier },
        { jwt },
      )
      .pipe(Effect.mapError(mapAppleError));
  });

const resolveRemoteCertificateId = (
  credentials: AppleCredentials,
  serialNumber: string,
  jwt: string,
) =>
  Effect.gen(function* () {
    const apple = yield* AppleAppStoreConnect;
    const remoteCerts = yield* apple
      .listCertificates(credentials, {}, { jwt })
      .pipe(Effect.mapError(mapAppleError));
    const match = remoteCerts.find((entry) => entry.serialNumber === serialNumber);
    if (match === undefined) {
      return yield* Effect.fail(
        new BadRequest({
          message: "Distribution certificate not present on Apple portal; upload it first",
        }),
      );
    }
    return match.id;
  });

const collectDeviceAscIds = (params: {
  readonly organizationId: string;
  readonly appleTeamId: string;
  readonly deviceIds?: readonly string[];
}) =>
  Effect.gen(function* () {
    const devices = yield* DeviceRepo;
    const candidates = yield* devices.findAllByOrg({
      organizationId: params.organizationId,
      appleTeamId: params.appleTeamId,
    });
    const filtered =
      params.deviceIds === undefined
        ? candidates
        : candidates.filter((device) => params.deviceIds?.includes(device.id));
    return filtered
      .map((device) => device.appleDevicePortalId)
      .filter((id): id is string => id !== null);
  });

const loadPreconditions = (params: GenerateProvisioningProfileParams) =>
  Effect.gen(function* () {
    const ascKeys = yield* AscApiKeyRepo;
    const certs = yield* AppleDistributionCertificateRepo;
    const teams = yield* AppleTeamRepo;

    const ascKey = yield* ascKeys.findById({ id: params.ascApiKeyId });
    if (ascKey.organizationId !== params.organizationId) {
      return yield* Effect.fail(new NotFound({ message: "ASC API key not found" }));
    }
    if (ascKey.appleTeamId === null) {
      return yield* Effect.fail(
        new BadRequest({ message: "ASC API key has no Apple team assignment" }),
      );
    }
    const team = yield* teams.findById({ id: ascKey.appleTeamId });
    const cert = yield* certs.findById({ id: params.appleDistributionCertificateId });
    if (cert.organizationId !== params.organizationId) {
      return yield* Effect.fail(new NotFound({ message: "Distribution certificate not found" }));
    }
    if (cert.appleTeamId !== team.id) {
      return yield* Effect.fail(
        new BadRequest({ message: "Certificate and ASC key belong to different Apple teams" }),
      );
    }
    return { ascKey, cert, team };
  });

export const generateProvisioningProfile = (params: GenerateProvisioningProfileParams) =>
  Effect.gen(function* () {
    const env = yield* cloudflareEnv;
    const apple = yield* AppleAppStoreConnect;
    const profiles = yield* AppleProvisioningProfileRepo;
    const { ascKey, cert, team } = yield* loadPreconditions(params);

    const credentials = yield* loadAscCredentials(params.organizationId, ascKey, team.appleTeamId);
    const jwt = yield* apple.signJwt(credentials).pipe(Effect.mapError(mapAppleError));
    const bundle = yield* ensureBundleId(credentials, params.bundleIdentifier, jwt);
    const remoteCertId = yield* resolveRemoteCertificateId(credentials, cert.serialNumber, jwt);

    const useDevices =
      params.distributionType === "AD_HOC" || params.distributionType === "DEVELOPMENT";
    const deviceAscIds: readonly string[] = useDevices
      ? yield* collectDeviceAscIds({
          organizationId: params.organizationId,
          appleTeamId: team.id,
          ...(params.deviceIds === undefined ? {} : { deviceIds: params.deviceIds }),
        })
      : [];

    if (useDevices && deviceAscIds.length === 0) {
      return yield* Effect.fail(
        new BadRequest({
          message: "No registered devices for the selected Apple team to attach to the profile",
        }),
      );
    }

    const generated = yield* apple
      .generateProvisioningProfile(
        credentials,
        {
          profileName: `${params.bundleIdentifier} ${params.distributionType} ${Date.now()}`,
          profileType: toProfileType(params.distributionType),
          bundleIdAscId: bundle.id,
          certificateAscIds: [remoteCertId],
          deviceAscIds,
        },
        { jwt },
      )
      .pipe(Effect.mapError(mapAppleError));

    const id = crypto.randomUUID();
    const r2Key = `apple-provisioning-profiles/${params.organizationId}/${id}.mobileprovision`;
    yield* Effect.promise(async () =>
      env.CREDENTIAL_ARTIFACTS.put(r2Key, fromBase64(generated.profileContent)),
    );

    const { model: saved, previousR2Key } = yield* withR2Compensation(
      env.CREDENTIAL_ARTIFACTS,
      r2Key,
      profiles.upsert({
        id,
        organizationId: params.organizationId,
        appleTeamId: team.id,
        appleDistributionCertificateId: cert.id,
        bundleIdentifier: params.bundleIdentifier,
        distributionType: params.distributionType,
        developerPortalIdentifier: generated.uuid,
        profileName: generated.name,
        validUntil: generated.expirationDate,
        r2Key,
      }),
    );

    if (previousR2Key !== null) {
      yield* Effect.promise(async () => env.CREDENTIAL_ARTIFACTS.delete(previousR2Key));
    }

    return saved;
  });
