import { fromBase64, toBase64 } from "@better-update/encoding";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { assertBindableProject, autoBindCredential } from "../application/auto-bind-credential";
import { logAudit } from "../audit/logger";
import {
  assertAppleCredentialAccess,
  assertAppleCredentialCreate,
  filterByAppleTeamRead,
} from "../auth/apple-team-access";
import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership } from "../auth/ownership";
import { assertAccessAny, assertOrgAdmin } from "../auth/policy";
import { CredentialArtifacts } from "../cloudflare/credential-artifacts";
import { parseProvisioningProfile } from "../domain/apple-provisioning-profile-parser";
import { BadRequest } from "../errors";
import { toApiAppleProvisioningProfile } from "../http/to-api";
import {
  toApiBadRequestReadEffect,
  toApiCrudEffect,
  toApiWriteEffect,
} from "../http/to-api-effect";
import { toDbNull } from "../lib/nullable";
import { withR2Compensation } from "../lib/r2-helpers";
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

// Toggle the per-row protected flag (GITLAB-RBAC-SPEC §3b) — org admin only,
// idempotent, audit-logged. The row flag is the whole gate for this
// credential; the team flag only guards team-level interactions.
const setProtectionEffect = (id: string, isProtected: boolean) =>
  toApiCrudEffect(
    Effect.gen(function* () {
      const repo = yield* AppleProvisioningProfileRepo;
      const existing = yield* repo.findById({ id });
      yield* assertOrgOwnership(existing.organizationId);
      yield* assertOrgAdmin;
      const ctx = yield* CurrentActor;
      yield* repo.setProtection({
        id,
        organizationId: ctx.organizationId,
        isProtected,
        now: new Date().toISOString(),
      });
      yield* logAudit({
        action: isProtected
          ? "apple.provisioning-profile.protect"
          : "apple.provisioning-profile.unprotect",
        resourceType: "appleCredential",
        resourceId: id,
        metadata: {
          bundleIdentifier: existing.bundleIdentifier,
          distributionType: existing.distributionType,
        },
      });
      return toApiAppleProvisioningProfile({ ...existing, isProtected });
    }),
  );

export const AppleProvisioningProfilesGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "appleProvisioningProfiles",
  (handlers) =>
    handlers
      .handle("list", ({ urlParams }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertAccessAny("appleCredential", "read");
            const ctx = yield* CurrentActor;
            const repo = yield* AppleProvisioningProfileRepo;
            const items = yield* repo.list({
              organizationId: ctx.organizationId,
              bundleIdentifier: urlParams.bundleIdentifier,
              distributionType: urlParams.distributionType,
              appleTeamId: urlParams.appleTeamId,
            });
            const visible = yield* filterByAppleTeamRead(
              items,
              (item) => item.appleTeamId,
              (item) => item.isProtected,
            );
            return { items: visible.map(toApiAppleProvisioningProfile) };
          }),
        ),
      )
      .handle("upload", ({ payload }) =>
        toApiWriteEffect(
          Effect.gen(function* () {
            const ctx = yield* CurrentActor;
            const artifacts = yield* CredentialArtifacts;
            const teams = yield* AppleTeamRepo;
            const repo = yield* AppleProvisioningProfileRepo;

            const bytes = yield* decodeBase64(payload.profileBase64);
            const parsed = yield* parseProvisioningProfile(bytes).pipe(Effect.mapError(mapInvalid));
            yield* assertAppleCredentialCreate({
              appleTeamIdentifier: parsed.appleTeamId,
              projectId: payload.projectId,
            });
            yield* assertBindableProject(payload.projectId);

            const team = yield* teams.upsertByAppleTeamId({
              organizationId: ctx.organizationId,
              appleTeamId: parsed.appleTeamId,
              appleTeamType: "COMPANY_ORGANIZATION",
              name: parsed.teamName,
            });

            yield* autoBindCredential({
              resourceType: "appleTeam",
              resourceId: team.id,
              projectId: payload.projectId,
            });

            const id = crypto.randomUUID();
            const r2Key = `apple-provisioning-profiles/${ctx.organizationId}/${id}.mobileprovision`;
            yield* artifacts.put(r2Key, bytes);

            const { model: profile, previousR2Key } = yield* withR2Compensation(
              artifacts.delete(r2Key),
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
                isManaged: payload.isManaged ?? false,
                deviceRosterHash: toDbNull(payload.deviceRosterHash),
                isProtected: team.isProtected,
              }),
            );

            if (previousR2Key !== null) {
              yield* artifacts.delete(previousR2Key);
            }

            yield* logAudit({
              action: "apple.provisioning-profile.upload",
              resourceType: "appleCredential",
              resourceId: profile.id,
              metadata: {
                bundleIdentifier: parsed.bundleIdentifier,
                distributionType: parsed.distributionType,
                appleTeamId: parsed.appleTeamId,
                isManaged: payload.isManaged ?? false,
              },
            });

            return toApiAppleProvisioningProfile(profile);
          }),
        ),
      )
      .handle("delete", ({ path }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            const artifacts = yield* CredentialArtifacts;
            const repo = yield* AppleProvisioningProfileRepo;
            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);
            yield* assertAppleCredentialAccess({
              action: "delete",
              appleTeamRowId: existing.appleTeamId,
              credentialIsProtected: existing.isProtected,
            });
            const { r2Key } = yield* repo.delete({ id: path.id });
            if (r2Key !== null) {
              yield* artifacts.delete(r2Key);
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
      )
      .handle("download", ({ path }) =>
        toApiBadRequestReadEffect(
          Effect.gen(function* () {
            const repo = yield* AppleProvisioningProfileRepo;
            const artifacts = yield* CredentialArtifacts;

            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);
            yield* assertAppleCredentialAccess({
              action: "download",
              appleTeamRowId: existing.appleTeamId,
              credentialIsProtected: existing.isProtected,
            });

            const profileBytes = yield* artifacts.get(existing.r2Key, "Provisioning profile");

            yield* logAudit({
              action: "apple.provisioning-profile.download",
              resourceType: "appleCredential",
              resourceId: path.id,
              metadata: {
                bundleIdentifier: existing.bundleIdentifier,
                distributionType: existing.distributionType,
              },
            });

            return {
              id: existing.id,
              profileBase64: toBase64(profileBytes),
              bundleIdentifier: existing.bundleIdentifier,
              distributionType: existing.distributionType,
              profileName: existing.profileName,
              developerPortalIdentifier: existing.developerPortalIdentifier,
            };
          }),
        ),
      )
      .handle("protect", ({ path }) => setProtectionEffect(path.id, true))
      .handle("unprotect", ({ path }) => setProtectionEffect(path.id, false)),
);
