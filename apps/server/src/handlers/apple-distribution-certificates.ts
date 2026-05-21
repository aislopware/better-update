import { fromBase64, toBase64 } from "@better-update/encoding";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { assertVaultVersionCurrent } from "../application/assert-vault-version";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { CredentialArtifacts } from "../cloudflare/credential-artifacts";
import { BadRequest } from "../errors";
import { toApiAppleDistributionCertificate } from "../http/to-api";
import {
  toApiBadRequestReadEffect,
  toApiCrudEffect,
  toApiWriteEffect,
} from "../http/to-api-effect";
import { toDbNull } from "../lib/nullable";
import { withR2Compensation } from "../lib/r2-helpers";
import { AppleDistributionCertificateRepo } from "../repositories/apple-distribution-certificates";
import { AppleTeamRepo } from "../repositories/apple-teams";

const decodeBase64 = (value: string) =>
  Effect.try({
    try: () => fromBase64(value),
    catch: () => new BadRequest({ message: "Distribution certificate must be valid base64" }),
  });

export const AppleDistributionCertificatesGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "appleDistributionCertificates",
  (handlers) =>
    handlers
      .handle("list", () =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertPermission("appleCredential", "read");
            const ctx = yield* CurrentActor;
            const repo = yield* AppleDistributionCertificateRepo;
            const items = yield* repo.listByOrg({ organizationId: ctx.organizationId });
            return { items: items.map(toApiAppleDistributionCertificate) };
          }),
        ),
      )
      .handle("upload", ({ payload }) =>
        toApiWriteEffect(
          Effect.gen(function* () {
            yield* assertPermission("appleCredential", "create");
            const ctx = yield* CurrentActor;
            const artifacts = yield* CredentialArtifacts;
            const teams = yield* AppleTeamRepo;
            const repo = yield* AppleDistributionCertificateRepo;

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

            const r2Key = `apple-distribution-certificates/${ctx.organizationId}/${crypto.randomUUID()}.p12.enc`;
            yield* artifacts.put(r2Key, blob);

            const developerIdIdentifier = toDbNull(payload.developerIdIdentifier);
            const now = new Date().toISOString();
            yield* withR2Compensation(
              artifacts.delete(r2Key),
              repo.insert({
                id: payload.id,
                organizationId: ctx.organizationId,
                appleTeamId: team.id,
                serialNumber: payload.serialNumber,
                developerIdIdentifier,
                validFrom: payload.validFrom,
                validUntil: payload.validUntil,
                r2Key,
                wrappedDek: payload.wrappedDek,
                vaultVersion: payload.vaultVersion,
                createdAt: now,
                updatedAt: now,
              }),
            );

            yield* logAudit({
              action: "apple.distribution-certificate.upload",
              resourceType: "appleCredential",
              resourceId: payload.id,
              metadata: {
                serialNumber: payload.serialNumber,
                appleTeamId: payload.appleTeamIdentifier,
              },
            });

            return toApiAppleDistributionCertificate({
              id: payload.id,
              organizationId: ctx.organizationId,
              appleTeamId: team.id,
              serialNumber: payload.serialNumber,
              developerIdIdentifier,
              validFrom: payload.validFrom,
              validUntil: payload.validUntil,
              r2Key,
              wrappedDek: payload.wrappedDek,
              vaultVersion: payload.vaultVersion,
              createdAt: now,
              updatedAt: now,
            });
          }),
        ),
      )
      .handle("delete", ({ path }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertPermission("appleCredential", "delete");
            const artifacts = yield* CredentialArtifacts;
            const repo = yield* AppleDistributionCertificateRepo;
            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);
            const { r2Key } = yield* repo.delete({ id: path.id });
            if (r2Key !== null) {
              yield* artifacts.delete(r2Key);
            }
            yield* logAudit({
              action: "apple.distribution-certificate.delete",
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
            yield* assertPermission("appleCredential", "download");
            const repo = yield* AppleDistributionCertificateRepo;
            const teams = yield* AppleTeamRepo;
            const artifacts = yield* CredentialArtifacts;

            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);
            const team = yield* teams.findById({ id: existing.appleTeamId });

            const blob = yield* artifacts.get(existing.r2Key, "Distribution certificate");

            yield* logAudit({
              action: "apple.distribution-certificate.download",
              resourceType: "appleCredential",
              resourceId: path.id,
              metadata: { serialNumber: existing.serialNumber },
            });

            return {
              id: existing.id,
              ciphertext: toBase64(blob),
              wrappedDek: existing.wrappedDek,
              vaultVersion: existing.vaultVersion,
              serialNumber: existing.serialNumber,
              appleTeamIdentifier: team.appleTeamId,
              validFrom: existing.validFrom,
              validUntil: existing.validUntil,
            };
          }),
        ),
      ),
);
