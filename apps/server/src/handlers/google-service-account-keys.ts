import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { cloudflareEnv } from "../cloudflare/context";
import { Vault } from "../cloudflare/vault";
import { parseGoogleServiceAccountKey } from "../domain/google-service-account-key-parser";
import { BadRequest } from "../errors";
import { toApiGoogleServiceAccountKey } from "../http/to-api";
import { toApiCrudEffect, toApiWriteEffect } from "../http/to-api-effect";
import { r2Operation, withR2Compensation } from "../lib/r2-helpers";
import { GoogleServiceAccountKeyRepo } from "../repositories/google-service-account-keys";

import type { InvalidGoogleServiceAccountKey } from "../domain/google-service-account-key-parser";

const mapInvalid = (error: InvalidGoogleServiceAccountKey) =>
  new BadRequest({ message: error.message });

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
            const env = yield* cloudflareEnv;
            const vault = yield* Vault;
            const repo = yield* GoogleServiceAccountKeyRepo;

            const parsed = yield* parseGoogleServiceAccountKey(payload.json).pipe(
              Effect.mapError(mapInvalid),
            );

            const plaintext = new TextEncoder().encode(payload.json);
            const encrypted = yield* vault
              .envelopeEncrypt({ organizationId: ctx.organizationId, plaintext })
              .pipe(Effect.mapError(() => new BadRequest({ message: "Encryption failed" })));

            const id = crypto.randomUUID();
            const r2Key = `google-service-account-keys/${ctx.organizationId}/${id}.json.enc`;
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
                clientEmail: parsed.clientEmail,
                privateKeyId: parsed.privateKeyId,
                googleProjectId: parsed.googleProjectId,
                r2Key,
                encryptedDek: encrypted.encryptedDek,
                dekKeyVersion: encrypted.keyVersion,
                createdAt: now,
                updatedAt: now,
              }),
            );

            yield* logAudit({
              action: "google.service-account-key.upload",
              resourceType: "androidCredential",
              resourceId: id,
              metadata: {
                clientEmail: parsed.clientEmail,
                privateKeyId: parsed.privateKeyId,
                googleProjectId: parsed.googleProjectId,
              },
            });

            return toApiGoogleServiceAccountKey({
              id,
              organizationId: ctx.organizationId,
              clientEmail: parsed.clientEmail,
              privateKeyId: parsed.privateKeyId,
              googleProjectId: parsed.googleProjectId,
              r2Key,
              encryptedDek: encrypted.encryptedDek,
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
            yield* assertPermission("androidCredential", "delete");
            const env = yield* cloudflareEnv;
            const repo = yield* GoogleServiceAccountKeyRepo;
            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);
            const { r2Key } = yield* repo.delete({ id: path.id });
            if (r2Key !== null) {
              yield* Effect.promise(async () => env.CREDENTIAL_ARTIFACTS.delete(r2Key));
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
      ),
);
