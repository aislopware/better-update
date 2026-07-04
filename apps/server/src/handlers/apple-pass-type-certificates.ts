import { fromBase64, toBase64 } from "@better-update/encoding";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { assertVaultVersionCurrent } from "../application/assert-vault-version";
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
import { BadRequest } from "../errors";
import { toApiApplePassTypeCertificate } from "../http/to-api";
import {
  toApiBadRequestReadEffect,
  toApiCrudEffect,
  toApiWriteEffect,
} from "../http/to-api-effect";
import { toDbNull } from "../lib/nullable";
import { withR2Compensation } from "../lib/r2-helpers";
import { ApplePassTypeCertificateRepo } from "../repositories/apple-pass-type-certificates";
import { AppleTeamRepo } from "../repositories/apple-teams";

const decodeBase64 = (value: string) =>
  Effect.try({
    try: () => fromBase64(value),
    catch: () => new BadRequest({ message: "Pass Type ID certificate must be valid base64" }),
  });

// Toggle the per-row protected flag (GITLAB-RBAC-SPEC §3b) — org admin only,
// idempotent, audit-logged. The row flag is the whole gate for this
// credential; the team flag only guards team-level interactions.
const setProtectionEffect = (id: string, isProtected: boolean) =>
  toApiCrudEffect(
    Effect.gen(function* () {
      const repo = yield* ApplePassTypeCertificateRepo;
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
          ? "apple.pass-type-certificate.protect"
          : "apple.pass-type-certificate.unprotect",
        resourceType: "appleCredential",
        resourceId: id,
        metadata: {
          serialNumber: existing.serialNumber,
          passTypeIdentifier: existing.passTypeIdentifier,
        },
      });
      return toApiApplePassTypeCertificate({ ...existing, isProtected });
    }),
  );

export const ApplePassTypeCertificatesGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "applePassTypeCertificates",
  (handlers) =>
    handlers
      .handle("list", () =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertAccessAny("appleCredential", "read");
            const ctx = yield* CurrentActor;
            const repo = yield* ApplePassTypeCertificateRepo;
            const items = yield* repo.listByOrg({ organizationId: ctx.organizationId });
            const visible = yield* filterByAppleTeamRead(
              items,
              (item) => item.appleTeamId,
              (item) => item.isProtected,
            );
            return { items: visible.map(toApiApplePassTypeCertificate) };
          }),
        ),
      )
      .handle("upload", ({ payload }) =>
        toApiWriteEffect(
          Effect.gen(function* () {
            yield* assertAppleCredentialCreate({
              appleTeamIdentifier: payload.appleTeamIdentifier,
              projectId: payload.projectId,
            });
            yield* assertBindableProject(payload.projectId);
            const ctx = yield* CurrentActor;
            const artifacts = yield* CredentialArtifacts;
            const teams = yield* AppleTeamRepo;
            const repo = yield* ApplePassTypeCertificateRepo;

            yield* assertVaultVersionCurrent({
              organizationId: ctx.organizationId,
              vaultVersion: payload.vaultVersion,
            });

            const blob = yield* decodeBase64(payload.ciphertext);

            const team = yield* teams.upsertByAppleTeamId({
              organizationId: ctx.organizationId,
              appleTeamId: payload.appleTeamIdentifier,
              appleTeamType: payload.appleTeamType ?? "COMPANY_ORGANIZATION",
              name: toDbNull(payload.appleTeamName),
            });

            yield* autoBindCredential({
              resourceType: "appleTeam",
              resourceId: team.id,
              projectId: payload.projectId,
            });

            const r2Key = `apple-pass-type-certificates/${ctx.organizationId}/${crypto.randomUUID()}.p12.enc`;
            yield* artifacts.put(r2Key, blob);

            const now = new Date().toISOString();
            yield* withR2Compensation(
              artifacts.delete(r2Key),
              repo.insert({
                id: payload.id,
                organizationId: ctx.organizationId,
                appleTeamId: team.id,
                passTypeIdentifier: payload.passTypeIdentifier,
                serialNumber: payload.serialNumber,
                validFrom: payload.validFrom,
                validUntil: payload.validUntil,
                r2Key,
                wrappedDek: payload.wrappedDek,
                vaultVersion: payload.vaultVersion,
                isProtected: team.isProtected,
                createdAt: now,
                updatedAt: now,
              }),
            );

            yield* logAudit({
              action: "apple.pass-type-certificate.upload",
              resourceType: "appleCredential",
              resourceId: payload.id,
              metadata: {
                serialNumber: payload.serialNumber,
                passTypeIdentifier: payload.passTypeIdentifier,
                appleTeamId: payload.appleTeamIdentifier,
              },
            });

            return toApiApplePassTypeCertificate({
              id: payload.id,
              organizationId: ctx.organizationId,
              appleTeamId: team.id,
              passTypeIdentifier: payload.passTypeIdentifier,
              serialNumber: payload.serialNumber,
              validFrom: payload.validFrom,
              validUntil: payload.validUntil,
              r2Key,
              wrappedDek: payload.wrappedDek,
              vaultVersion: payload.vaultVersion,
              isProtected: team.isProtected,
              createdAt: now,
              updatedAt: now,
            });
          }),
        ),
      )
      .handle("delete", ({ path }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            const artifacts = yield* CredentialArtifacts;
            const repo = yield* ApplePassTypeCertificateRepo;
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
              action: "apple.pass-type-certificate.delete",
              resourceType: "appleCredential",
              resourceId: path.id,
              metadata: { serialNumber: existing.serialNumber },
            });
            return { deleted: 1 };
          }),
        ),
      )
      .handle("download", ({ path }) =>
        toApiBadRequestReadEffect(
          Effect.gen(function* () {
            const repo = yield* ApplePassTypeCertificateRepo;
            const teams = yield* AppleTeamRepo;
            const artifacts = yield* CredentialArtifacts;

            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);
            const team = yield* teams.findById({ id: existing.appleTeamId });
            yield* assertAppleCredentialAccess({
              action: "download",
              appleTeamRowId: existing.appleTeamId,
              credentialIsProtected: existing.isProtected,
            });

            const blob = yield* artifacts.get(existing.r2Key, "Pass Type ID certificate");

            yield* logAudit({
              action: "apple.pass-type-certificate.download",
              resourceType: "appleCredential",
              resourceId: path.id,
              metadata: { serialNumber: existing.serialNumber },
            });

            return {
              id: existing.id,
              ciphertext: toBase64(blob),
              wrappedDek: existing.wrappedDek,
              vaultVersion: existing.vaultVersion,
              passTypeIdentifier: existing.passTypeIdentifier,
              serialNumber: existing.serialNumber,
              appleTeamIdentifier: team.appleTeamId,
              validFrom: existing.validFrom,
              validUntil: existing.validUntil,
            };
          }),
        ),
      )
      .handle("protect", ({ path }) => setProtectionEffect(path.id, true))
      .handle("unprotect", ({ path }) => setProtectionEffect(path.id, false)),
);
