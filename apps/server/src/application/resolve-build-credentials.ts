import { toBase64 } from "@better-update/encoding";
import { Effect } from "effect";

import { CredentialArtifacts } from "../cloudflare/credential-artifacts";
import { computeDeviceRosterHash } from "../domain/device-roster-hash";
import { BadRequest, NotFound } from "../errors";
import { requireValue } from "../lib/require-value";
import { AndroidApplicationIdentifierRepo } from "../repositories/android-application-identifiers";
import { AndroidBuildCredentialsRepo } from "../repositories/android-build-credentials";
import { AndroidUploadKeystoreRepo } from "../repositories/android-upload-keystores";
import { AppleDistributionCertificateRepo } from "../repositories/apple-distribution-certificates";
import { AppleProvisioningProfileRepo } from "../repositories/apple-provisioning-profiles";
import { ApplePushKeyRepo } from "../repositories/apple-push-keys";
import { AppleTeamRepo } from "../repositories/apple-teams";
import { AscApiKeyRepo } from "../repositories/asc-api-keys";
import { IosBundleConfigurationRepo } from "../repositories/ios-bundle-configurations";
import { collectDeviceAscIds } from "./collect-device-asc-ids";

import type { AppleProvisioningProfileModel, DistributionType } from "../models";

const hashFailure = () => new BadRequest({ message: "Failed to hash device roster" });

interface IosResolveInput {
  readonly organizationId: string;
  readonly projectId: string;
  readonly bundleIdentifier: string;
  readonly distributionType: DistributionType;
}

interface AndroidResolveInput {
  readonly organizationId: string;
  readonly projectId: string;
  readonly applicationIdentifier: string;
  readonly buildProfile?: string | undefined;
}

export interface IosResolvedIds {
  readonly distributionCertificateId: string;
  readonly provisioningProfileId: string;
  readonly pushKeyId: string | null;
  readonly profileStale: boolean;
  readonly currentDeviceRosterHash: string | null;
}

export interface AndroidResolvedIds {
  readonly keystoreId: string;
  readonly buildCredentialsGroupId: string;
}

const loadIosBundleConfiguration = (input: IosResolveInput) =>
  Effect.gen(function* () {
    const repo = yield* IosBundleConfigurationRepo;
    const config = yield* repo.findByProjectAndBundle({
      projectId: input.projectId,
      bundleIdentifier: input.bundleIdentifier,
      distributionType: input.distributionType,
    });
    if (config.organizationId !== input.organizationId) {
      return yield* new NotFound({
        message: `No iOS bundle configuration found for ${input.bundleIdentifier} (${input.distributionType})`,
      });
    }
    return config;
  });

const checkProfileStale = (
  params: IosResolveInput & {
    readonly profile: AppleProvisioningProfileModel;
    readonly appleTeamId: string;
  },
) =>
  Effect.gen(function* () {
    if (params.distributionType === "APP_STORE" || params.distributionType === "ENTERPRISE") {
      return { stale: false, currentHash: null } as const;
    }
    if (!params.profile.isManaged) {
      return { stale: false, currentHash: null } as const;
    }
    const currentAscIds = yield* collectDeviceAscIds({
      organizationId: params.organizationId,
      appleTeamId: params.appleTeamId,
    });
    const currentHash = yield* computeDeviceRosterHash(currentAscIds).pipe(
      Effect.mapError(hashFailure),
    );
    return {
      stale: currentHash !== params.profile.deviceRosterHash,
      currentHash,
    } as const;
  });

const assertOwned = <Entity extends { readonly organizationId: string }>(
  entity: Entity,
  organizationId: string,
  message: string,
): Effect.Effect<Entity, NotFound> =>
  entity.organizationId === organizationId
    ? Effect.succeed(entity)
    : Effect.fail(new NotFound({ message }));

const loadDistributionCertificate = (id: string, organizationId: string) =>
  Effect.gen(function* () {
    const certs = yield* AppleDistributionCertificateRepo;
    const cert = yield* certs.findById({ id });
    return yield* assertOwned(cert, organizationId, "Distribution certificate not found");
  });

const loadProfile = (id: string, organizationId: string) =>
  Effect.gen(function* () {
    const profiles = yield* AppleProvisioningProfileRepo;
    const profile = yield* profiles.findById({ id });
    return yield* assertOwned(profile, organizationId, "Provisioning profile not found");
  });

const loadPushKey = (id: string | null, organizationId: string) =>
  Effect.gen(function* () {
    if (id === null) {
      return null;
    }
    const keys = yield* ApplePushKeyRepo;
    const key = yield* keys.findById({ id });
    return yield* assertOwned(key, organizationId, "Push key not found");
  });

const loadTeam = (id: string) =>
  Effect.gen(function* () {
    const teams = yield* AppleTeamRepo;
    return yield* teams.findById({ id });
  });

/**
 * Mirrors EAS CLI's account-level ASC key resolution: a single key per team
 * provisions every bundle under that team. Explicit per-bundle bindings always
 * win; when absent, fall back to the most-recently uploaded key scoped to the
 * same (org, team) so extension bundles can be auto-provisioned without forcing
 * the dashboard binding step.
 */
const resolveAscApiKeyId = (params: {
  readonly explicitId: string | null;
  readonly organizationId: string;
  readonly appleTeamId: string;
}) =>
  Effect.gen(function* () {
    if (params.explicitId !== null) {
      return params.explicitId;
    }
    const repo = yield* AscApiKeyRepo;
    const candidates = yield* repo.listByOrgAndTeam({
      organizationId: params.organizationId,
      appleTeamId: params.appleTeamId,
    });
    const [first] = candidates;
    if (first === undefined) {
      return null;
    }
    return first.id;
  });

export const resolveIosBuildCredentials = (input: IosResolveInput) =>
  Effect.gen(function* () {
    const config = yield* loadIosBundleConfiguration(input);

    const certId = yield* requireValue(
      config.appleDistributionCertificateId,
      "appleDistributionCertificateId",
    );
    const profileId = yield* requireValue(
      config.appleProvisioningProfileId,
      "appleProvisioningProfileId",
    );

    const [cert, profile, pushKey, team] = yield* Effect.all(
      [
        loadDistributionCertificate(certId, input.organizationId),
        loadProfile(profileId, input.organizationId),
        loadPushKey(config.applePushKeyId, input.organizationId),
        loadTeam(config.appleTeamId),
      ],
      { concurrency: "unbounded" },
    );

    if (cert.appleTeamId !== team.id || profile.appleTeamId !== team.id) {
      return yield* new BadRequest({
        message:
          "iOS bundle configuration binds a certificate or profile from a different Apple team",
      });
    }

    const { stale: profileStale, currentHash: currentDeviceRosterHash } = yield* checkProfileStale({
      ...input,
      profile,
      appleTeamId: team.id,
    });

    const resolvedAscApiKeyId = yield* resolveAscApiKeyId({
      explicitId: config.ascApiKeyId,
      organizationId: input.organizationId,
      appleTeamId: team.id,
    });

    const artifacts = yield* CredentialArtifacts;

    // The push key is bound and fetched at submit time, not build time, so the
    // build-resolve response carries only its id (`pushKeyId` below) — never the
    // R2 blob, which the CLI build path never decrypts.
    const [certBlob, profileBytes] = yield* Effect.all(
      [
        artifacts.get(cert.r2Key, "Distribution certificate"),
        artifacts.get(profile.r2Key, "Provisioning profile"),
      ],
      { concurrency: "unbounded" },
    );

    return {
      response: {
        platform: "ios",
        distributionCertificate: {
          ciphertext: toBase64(certBlob),
          wrappedDek: cert.wrappedDek,
          vaultVersion: cert.vaultVersion,
        },
        provisioningProfile: {
          mobileprovisionBase64: toBase64(profileBytes),
          uuid: profile.developerPortalIdentifier,
          name: profile.profileName,
          teamId: team.appleTeamId,
          bundleIdentifier: profile.bundleIdentifier,
          distributionType: profile.distributionType,
        },
        profileStale,
        currentDeviceRosterHash,
        context: {
          ascApiKeyId: resolvedAscApiKeyId,
          distributionCertificateId: cert.id,
          appleTeamId: team.id,
          appleTeamIdentifier: team.appleTeamId,
        },
      },
      resolvedIds: {
        distributionCertificateId: cert.id,
        provisioningProfileId: profile.id,
        pushKeyId: pushKey === null ? null : pushKey.id,
        profileStale,
        currentDeviceRosterHash,
      } satisfies IosResolvedIds,
    } as const;
  });

const loadAndroidApplicationIdentifier = (input: AndroidResolveInput) =>
  Effect.gen(function* () {
    const apps = yield* AndroidApplicationIdentifierRepo;
    const app = yield* apps.findByProjectAndPackage({
      projectId: input.projectId,
      packageName: input.applicationIdentifier,
    });
    if (app.organizationId !== input.organizationId) {
      return yield* new NotFound({
        message: `No Android application identifier registered for ${input.applicationIdentifier}`,
      });
    }
    return app;
  });

export const resolveAndroidBuildCredentials = (input: AndroidResolveInput) =>
  Effect.gen(function* () {
    const app = yield* loadAndroidApplicationIdentifier(input);

    const buildCreds = yield* AndroidBuildCredentialsRepo;
    const profileMatch =
      input.buildProfile === undefined
        ? null
        : yield* buildCreds.findByAppIdentifierAndName({
            androidApplicationIdentifierId: app.id,
            name: input.buildProfile,
          });

    const group = yield* Effect.gen(function* () {
      if (profileMatch !== null && profileMatch.androidUploadKeystoreId !== null) {
        return profileMatch;
      }
      const groups = yield* buildCreds.listByAppIdentifier({
        androidApplicationIdentifierId: app.id,
      });
      const fallback = groups.find((entry) => entry.androidUploadKeystoreId !== null);
      return fallback ?? profileMatch;
    });

    if (!group?.androidUploadKeystoreId) {
      return yield* new BadRequest({
        message: `No Android build credentials group with a keystore is bound to ${input.applicationIdentifier}`,
      });
    }
    const keystoreId = group.androidUploadKeystoreId;
    if (input.buildProfile !== undefined && group.name !== input.buildProfile) {
      yield* Effect.log("Build profile credential group missing, using fallback", {
        groupId: group.id,
        applicationIdentifier: input.applicationIdentifier,
        requestedProfile: input.buildProfile,
        fallbackName: group.name,
      });
    } else if (!group.isDefault && input.buildProfile === undefined) {
      yield* Effect.log("Falling back to non-default Android build credentials group", {
        groupId: group.id,
        applicationIdentifier: input.applicationIdentifier,
      });
    }

    const keystores = yield* AndroidUploadKeystoreRepo;
    const keystore = yield* keystores.findById({ id: keystoreId });
    if (keystore.organizationId !== input.organizationId) {
      return yield* new NotFound({ message: "Keystore not found" });
    }

    const artifacts = yield* CredentialArtifacts;
    const keystoreBytes = yield* artifacts.get(keystore.r2Key, "Android keystore");

    return {
      response: {
        platform: "android",
        keystore: {
          id: keystore.id,
          ciphertext: toBase64(keystoreBytes),
          wrappedDek: keystore.wrappedDek,
          vaultVersion: keystore.vaultVersion,
          keyAlias: keystore.keyAlias,
        },
      },
      resolvedIds: {
        keystoreId: keystore.id,
        buildCredentialsGroupId: group.id,
      } satisfies AndroidResolvedIds,
    } as const;
  });
