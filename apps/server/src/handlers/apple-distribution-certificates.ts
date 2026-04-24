import { fromBase64 } from "@better-update/encoding";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { cloudflareEnv } from "../cloudflare/context";
import { Vault } from "../cloudflare/vault";
import {
  validateDistributionCertificateMetadata,
  validatePkcs12Blob,
} from "../domain/apple-certificate-parser";
import { BadRequest } from "../errors";
import { toApiAppleDistributionCertificate } from "../http/to-api";
import { toApiCrudEffect, toApiWriteEffect } from "../http/to-api-effect";
import { r2Operation, withR2Compensation } from "../lib/r2-helpers";
import { AppleDistributionCertificateRepo } from "../repositories/apple-distribution-certificates";
import { AppleTeamRepo } from "../repositories/apple-teams";

import type { InvalidAppleCertificate } from "../domain/apple-certificate-parser";

const mapInvalid = (error: InvalidAppleCertificate) => new BadRequest({ message: error.message });

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
            const env = yield* cloudflareEnv;
            const vault = yield* Vault;
            const teams = yield* AppleTeamRepo;
            const repo = yield* AppleDistributionCertificateRepo;

            const blob = yield* decodeBase64(payload.p12Base64);
            yield* validatePkcs12Blob(blob).pipe(Effect.mapError(mapInvalid));
            const parsed = yield* validateDistributionCertificateMetadata({
              serialNumber: payload.serialNumber,
              appleTeamId: payload.appleTeamIdentifier,
              ...(payload.appleTeamName === undefined
                ? {}
                : { appleTeamName: payload.appleTeamName }),
              ...(payload.developerIdIdentifier === undefined
                ? {}
                : { developerIdIdentifier: payload.developerIdIdentifier }),
              validFrom: payload.validFrom,
              validUntil: payload.validUntil,
            }).pipe(Effect.mapError(mapInvalid));

            const team = yield* teams.upsertByAppleTeamId({
              organizationId: ctx.organizationId,
              appleTeamId: parsed.appleTeamId,
              appleTeamType: payload.appleTeamType ?? "COMPANY_ORGANIZATION",
              name: parsed.appleTeamName,
            });

            const encrypted = yield* vault
              .envelopeEncrypt({ organizationId: ctx.organizationId, plaintext: blob })
              .pipe(Effect.mapError(() => new BadRequest({ message: "Encryption failed" })));
            const password = yield* vault
              .encryptSecret({ organizationId: ctx.organizationId, value: payload.p12Password })
              .pipe(Effect.mapError(() => new BadRequest({ message: "Encryption failed" })));

            const id = crypto.randomUUID();
            const r2Key = `apple-distribution-certificates/${ctx.organizationId}/${id}.p12.enc`;
            yield* r2Operation(async () =>
              env.CREDENTIAL_ARTIFACTS.put(r2Key, encrypted.encryptedBlob),
            );

            const now = new Date().toISOString();
            yield* withR2Compensation(
              env.CREDENTIAL_ARTIFACTS,
              r2Key,
              repo.insert({
                id,
                organizationId: ctx.organizationId,
                appleTeamId: team.id,
                serialNumber: parsed.serialNumber,
                developerIdIdentifier: parsed.developerIdIdentifier,
                validFrom: parsed.validFrom,
                validUntil: parsed.validUntil,
                r2Key,
                encryptedDek: encrypted.encryptedDek,
                encryptedPassword: password.encrypted,
                passwordKeyVersion: password.keyVersion,
                dekKeyVersion: encrypted.keyVersion,
                createdAt: now,
                updatedAt: now,
              }),
            );

            yield* logAudit({
              action: "apple.distribution-certificate.upload",
              resourceType: "appleCredential",
              resourceId: id,
              metadata: { serialNumber: parsed.serialNumber, appleTeamId: parsed.appleTeamId },
            });

            return toApiAppleDistributionCertificate({
              id,
              organizationId: ctx.organizationId,
              appleTeamId: team.id,
              serialNumber: parsed.serialNumber,
              developerIdIdentifier: parsed.developerIdIdentifier,
              validFrom: parsed.validFrom,
              validUntil: parsed.validUntil,
              r2Key,
              encryptedDek: encrypted.encryptedDek,
              encryptedPassword: password.encrypted,
              passwordKeyVersion: password.keyVersion,
              dekKeyVersion: encrypted.keyVersion,
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
            const env = yield* cloudflareEnv;
            const repo = yield* AppleDistributionCertificateRepo;
            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);
            const { r2Key } = yield* repo.delete({ id: path.id });
            if (r2Key !== null) {
              yield* Effect.promise(async () => env.CREDENTIAL_ARTIFACTS.delete(r2Key));
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
      ),
);
