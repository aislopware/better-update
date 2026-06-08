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
import { toApiGoogleServiceAccountKey } from "../http/to-api";
import {
  toApiBadRequestReadEffect,
  toApiCrudEffect,
  toApiWriteEffect,
} from "../http/to-api-effect";
import { toDbNull } from "../lib/nullable";
import { withR2Compensation } from "../lib/r2-helpers";
import { GoogleServiceAccountKeyRepo } from "../repositories/google-service-account-keys";

const decodeBase64 = (value: string) =>
  Effect.try({
    try: () => fromBase64(value),
    catch: () => new BadRequest({ message: "Service account key must be valid base64" }),
  });

export const GoogleServiceAccountKeysGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "googleServiceAccountKeys",
  (handlers) =>
    handlers
      .handle("list", () =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertPermission("androidCredential", "read");
            const ctx = yield* CurrentActor;
            const repo = yield* GoogleServiceAccountKeyRepo;
            const items = yield* repo.listByOrg({ organizationId: ctx.organizationId });
            return { items: items.map(toApiGoogleServiceAccountKey) };
          }),
        ),
      )
      .handle("upload", ({ payload }) =>
        toApiWriteEffect(
          Effect.gen(function* () {
            yield* assertPermission("androidCredential", "create");
            const ctx = yield* CurrentActor;
            const artifacts = yield* CredentialArtifacts;
            const repo = yield* GoogleServiceAccountKeyRepo;

            yield* assertVaultVersionCurrent({
              organizationId: ctx.organizationId,
              vaultVersion: payload.vaultVersion,
            });

            const blob = yield* decodeBase64(payload.ciphertext);
            const clientId = toDbNull(payload.clientId);

            const r2Key = `google-service-account-keys/${ctx.organizationId}/${crypto.randomUUID()}.json.enc`;
            yield* artifacts.put(r2Key, blob);

            const now = new Date().toISOString();
            yield* withR2Compensation(
              artifacts.delete(r2Key),
              repo.insert({
                id: payload.id,
                organizationId: ctx.organizationId,
                clientEmail: payload.clientEmail,
                privateKeyId: payload.privateKeyId,
                googleProjectId: payload.googleProjectId,
                clientId,
                r2Key,
                wrappedDek: payload.wrappedDek,
                vaultVersion: payload.vaultVersion,
                createdAt: now,
                updatedAt: now,
              }),
            );

            yield* logAudit({
              action: "google.service-account-key.upload",
              resourceType: "androidCredential",
              resourceId: payload.id,
              metadata: {
                clientEmail: payload.clientEmail,
                privateKeyId: payload.privateKeyId,
                googleProjectId: payload.googleProjectId,
              },
            });

            return toApiGoogleServiceAccountKey({
              id: payload.id,
              organizationId: ctx.organizationId,
              clientEmail: payload.clientEmail,
              privateKeyId: payload.privateKeyId,
              googleProjectId: payload.googleProjectId,
              clientId,
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
            yield* assertPermission("androidCredential", "delete");
            const artifacts = yield* CredentialArtifacts;
            const repo = yield* GoogleServiceAccountKeyRepo;
            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);
            const { r2Key } = yield* repo.delete({ id: path.id });
            if (r2Key !== null) {
              yield* artifacts.delete(r2Key);
            }
            yield* logAudit({
              action: "google.service-account-key.delete",
              resourceType: "androidCredential",
              resourceId: path.id,
              metadata: { privateKeyId: existing.privateKeyId },
            });
            return { deleted: 1 };
          }),
        ),
      )
      .handle("download", ({ path }) =>
        toApiBadRequestReadEffect(
          Effect.gen(function* () {
            yield* assertPermission("androidCredential", "download");
            const repo = yield* GoogleServiceAccountKeyRepo;
            const artifacts = yield* CredentialArtifacts;

            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);

            const blob = yield* artifacts.get(existing.r2Key, "Google service account key");

            yield* logAudit({
              action: "google.service-account-key.download",
              resourceType: "androidCredential",
              resourceId: path.id,
              metadata: { privateKeyId: existing.privateKeyId },
            });

            return {
              id: existing.id,
              ciphertext: toBase64(blob),
              wrappedDek: existing.wrappedDek,
              vaultVersion: existing.vaultVersion,
              clientEmail: existing.clientEmail,
            };
          }),
        ),
      ),
);
