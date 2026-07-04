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
import { toApiApplePayCertificate } from "../http/to-api";
import {
  toApiBadRequestReadEffect,
  toApiCrudEffect,
  toApiWriteEffect,
} from "../http/to-api-effect";
import { toDbNull } from "../lib/nullable";
import { withR2Compensation } from "../lib/r2-helpers";
import { ApplePayCertificateRepo } from "../repositories/apple-pay-certificates";
import { AppleTeamRepo } from "../repositories/apple-teams";

const decodeBase64 = (value: string) =>
  Effect.try({
    try: () => fromBase64(value),
    catch: () => new BadRequest({ message: "Apple Pay certificate must be valid base64" }),
  });

// Toggle the per-row protected flag (GITLAB-RBAC-SPEC §3b) — org admin only,
// idempotent, audit-logged. The row flag is the whole gate for this
// credential; the team flag only guards team-level interactions.
const setProtectionEffect = (id: string, isProtected: boolean) =>
  toApiCrudEffect(
    Effect.gen(function* () {
      const repo = yield* ApplePayCertificateRepo;
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
        action: isProtected ? "apple.pay-certificate.protect" : "apple.pay-certificate.unprotect",
        resourceType: "appleCredential",
        resourceId: id,
        metadata: {
          serialNumber: existing.serialNumber,
          merchantIdentifier: existing.merchantIdentifier,
        },
      });
      return toApiApplePayCertificate({ ...existing, isProtected });
    }),
  );

export const ApplePayCertificatesGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "applePayCertificates",
  (handlers) =>
    handlers
      .handle("list", () =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertAccessAny("appleCredential", "read");
            const ctx = yield* CurrentActor;
            const repo = yield* ApplePayCertificateRepo;
            const items = yield* repo.listByOrg({ organizationId: ctx.organizationId });
            const visible = yield* filterByAppleTeamRead(
              items,
              (item) => item.appleTeamId,
              (item) => item.isProtected,
            );
            return { items: visible.map(toApiApplePayCertificate) };
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
            const repo = yield* ApplePayCertificateRepo;

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

            const r2Key = `apple-pay-certificates/${ctx.organizationId}/${crypto.randomUUID()}.p12.enc`;
            yield* artifacts.put(r2Key, blob);

            const now = new Date().toISOString();
            yield* withR2Compensation(
              artifacts.delete(r2Key),
              repo.insert({
                id: payload.id,
                organizationId: ctx.organizationId,
                appleTeamId: team.id,
                merchantIdentifier: payload.merchantIdentifier,
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
              action: "apple.pay-certificate.upload",
              resourceType: "appleCredential",
              resourceId: payload.id,
              metadata: {
                serialNumber: payload.serialNumber,
                merchantIdentifier: payload.merchantIdentifier,
                appleTeamId: payload.appleTeamIdentifier,
              },
            });

            return toApiApplePayCertificate({
              id: payload.id,
              organizationId: ctx.organizationId,
              appleTeamId: team.id,
              merchantIdentifier: payload.merchantIdentifier,
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
            const repo = yield* ApplePayCertificateRepo;
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
              action: "apple.pay-certificate.delete",
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
            const repo = yield* ApplePayCertificateRepo;
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

            const blob = yield* artifacts.get(existing.r2Key, "Apple Pay certificate");

            yield* logAudit({
              action: "apple.pay-certificate.download",
              resourceType: "appleCredential",
              resourceId: path.id,
              metadata: { serialNumber: existing.serialNumber },
            });

            return {
              id: existing.id,
              ciphertext: toBase64(blob),
              wrappedDek: existing.wrappedDek,
              vaultVersion: existing.vaultVersion,
              merchantIdentifier: existing.merchantIdentifier,
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
