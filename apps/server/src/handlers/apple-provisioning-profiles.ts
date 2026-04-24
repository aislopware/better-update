import { fromBase64 } from "@better-update/encoding";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { generateProvisioningProfile } from "../application/generate-provisioning-profile";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { cloudflareEnv } from "../cloudflare/context";
import { parseProvisioningProfile } from "../domain/apple-provisioning-profile-parser";
import { BadRequest } from "../errors";
import { toApiAppleProvisioningProfile } from "../http/to-api";
import { toApiCrudEffect, toApiWriteEffect } from "../http/to-api-effect";
import { toDbNull } from "../lib/nullable";
import { r2Operation, withR2Compensation } from "../lib/r2-helpers";
import { AppleProvisioningProfileRepo } from "../repositories/apple-provisioning-profiles";
import { AppleTeamRepo } from "../repositories/apple-teams";

import type { InvalidProvisioningProfile } from "../domain/apple-provisioning-profile-parser";

const mapInvalid = (error: InvalidProvisioningProfile) =>
  new BadRequest({ message: error.message });

const decodeBase64 = (value: string) =>
  Effect.try({
    try: () => fromBase64(value),
    catch: () => new BadRequest({ message: "Provisioning profile must be valid base64" }),
  });

export const AppleProvisioningProfilesGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "appleProvisioningProfiles",
  (handlers) =>
    handlers
      .handle("list", ({ urlParams }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertPermission("appleCredential", "read");
            const ctx = yield* CurrentActor;
            const repo = yield* AppleProvisioningProfileRepo;
            const items = yield* repo.list({
              organizationId: ctx.organizationId,
              bundleIdentifier: urlParams.bundleIdentifier,
              distributionType: urlParams.distributionType,
              appleTeamId: urlParams.appleTeamId,
            });
            return { items: items.map(toApiAppleProvisioningProfile) };
          }),
        ),
      )
      .handle("upload", ({ payload }) =>
        toApiWriteEffect(
          Effect.gen(function* () {
            yield* assertPermission("appleCredential", "create");
            const ctx = yield* CurrentActor;
            const env = yield* cloudflareEnv;
            const teams = yield* AppleTeamRepo;
            const repo = yield* AppleProvisioningProfileRepo;

            const bytes = yield* decodeBase64(payload.profileBase64);
            const parsed = yield* parseProvisioningProfile(bytes).pipe(Effect.mapError(mapInvalid));

            const team = yield* teams.upsertByAppleTeamId({
              organizationId: ctx.organizationId,
              appleTeamId: parsed.appleTeamId,
              appleTeamType: "COMPANY_ORGANIZATION",
              name: null,
            });

            const id = crypto.randomUUID();
            const r2Key = `apple-provisioning-profiles/${ctx.organizationId}/${id}.mobileprovision`;
            yield* r2Operation(async () => env.CREDENTIAL_ARTIFACTS.put(r2Key, bytes));

            const { model: profile, previousR2Key } = yield* withR2Compensation(
              env.CREDENTIAL_ARTIFACTS,
              r2Key,
              repo.upsert({
                id,
                organizationId: ctx.organizationId,
                appleTeamId: team.id,
                appleDistributionCertificateId: toDbNull(payload.appleDistributionCertificateId),
                bundleIdentifier: parsed.bundleIdentifier,
                distributionType: parsed.distributionType,
                developerPortalIdentifier: parsed.developerPortalIdentifier,
                profileName: parsed.profileName,
                validUntil: parsed.validUntil,
                r2Key,
                isManaged: false,
                deviceRosterHash: null,
              }),
            );

            if (previousR2Key !== null) {
              yield* r2Operation(async () => env.CREDENTIAL_ARTIFACTS.delete(previousR2Key));
            }

            yield* logAudit({
              action: "apple.provisioning-profile.upload",
              resourceType: "appleCredential",
              resourceId: profile.id,
              metadata: {
                bundleIdentifier: parsed.bundleIdentifier,
                distributionType: parsed.distributionType,
                appleTeamId: parsed.appleTeamId,
              },
            });

            return toApiAppleProvisioningProfile(profile);
          }),
        ),
      )
      .handle("generate", ({ payload }) =>
        toApiWriteEffect(
          Effect.gen(function* () {
            yield* assertPermission("appleCredential", "create");
            const ctx = yield* CurrentActor;
            const saved = yield* generateProvisioningProfile({
              organizationId: ctx.organizationId,
              ascApiKeyId: payload.ascApiKeyId,
              appleDistributionCertificateId: payload.appleDistributionCertificateId,
              bundleIdentifier: payload.bundleIdentifier,
              distributionType: payload.distributionType,
              ...(payload.deviceIds === undefined ? {} : { deviceIds: payload.deviceIds }),
            });
            yield* logAudit({
              action: "apple.provisioning-profile.generate",
              resourceType: "appleCredential",
              resourceId: saved.id,
              metadata: {
                bundleIdentifier: saved.bundleIdentifier,
                distributionType: saved.distributionType,
              },
            });
            return toApiAppleProvisioningProfile(saved);
          }),
        ),
      )
      .handle("delete", ({ path }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertPermission("appleCredential", "delete");
            const env = yield* cloudflareEnv;
            const repo = yield* AppleProvisioningProfileRepo;
            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);
            const { r2Key } = yield* repo.delete({ id: path.id });
            if (r2Key !== null) {
              yield* Effect.promise(async () => env.CREDENTIAL_ARTIFACTS.delete(r2Key));
            }
            yield* logAudit({
              action: "apple.provisioning-profile.delete",
              resourceType: "appleCredential",
              resourceId: path.id,
              metadata: {
                bundleIdentifier: existing.bundleIdentifier,
                distributionType: existing.distributionType,
              },
            });
            return { deleted: 1 };
          }),
        ),
      ),
);
