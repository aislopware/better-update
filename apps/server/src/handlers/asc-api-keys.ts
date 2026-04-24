import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { syncDevices } from "../application/apple-device-sync";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { cloudflareEnv } from "../cloudflare/context";
import { Vault } from "../cloudflare/vault";
import { validateAscApiKey } from "../domain/asc-api-key-validator";
import { BadRequest, NotFound } from "../errors";
import { toApiAscApiKey } from "../http/to-api";
import { toApiCrudEffect, toApiWriteEffect } from "../http/to-api-effect";
import { toDbNull } from "../lib/nullable";
import { r2Operation, withR2Compensation } from "../lib/r2-helpers";
import { AppleTeamRepo } from "../repositories/apple-teams";
import { AscApiKeyRepo } from "../repositories/asc-api-keys";

import type { InvalidAscApiKey } from "../domain/asc-api-key-validator";

const mapInvalid = (error: InvalidAscApiKey) => new BadRequest({ message: error.message });

export const AscApiKeysGroupLive = HttpApiBuilder.group(ManagementApi, "ascApiKeys", (handlers) =>
  handlers
    .handle("list", () =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("appleCredential", "read");
          const ctx = yield* CurrentActor;
          const repo = yield* AscApiKeyRepo;
          const items = yield* repo.listByOrg({ organizationId: ctx.organizationId });
          return { items: items.map(toApiAscApiKey) };
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
          const repo = yield* AscApiKeyRepo;

          yield* validateAscApiKey({
            keyId: payload.keyId,
            issuerId: payload.issuerId,
            name: payload.name,
            pem: payload.p8Pem,
            ...(payload.appleTeamIdentifier === undefined
              ? {}
              : { appleTeamId: payload.appleTeamIdentifier }),
            ...(payload.roles === undefined ? {} : { roles: payload.roles }),
          }).pipe(Effect.mapError(mapInvalid));

          const teamId = payload.appleTeamIdentifier
            ? (yield* teams.upsertByAppleTeamId({
                organizationId: ctx.organizationId,
                appleTeamId: payload.appleTeamIdentifier,
                appleTeamType: payload.appleTeamType ?? "COMPANY_ORGANIZATION",
                name: toDbNull(payload.appleTeamName),
              })).id
            : null;

          const plaintext = new TextEncoder().encode(payload.p8Pem);
          const encrypted = yield* vault
            .envelopeEncrypt({ organizationId: ctx.organizationId, plaintext })
            .pipe(Effect.mapError(() => new BadRequest({ message: "Encryption failed" })));
          const issuer = yield* vault
            .encryptSecret({ organizationId: ctx.organizationId, value: payload.issuerId })
            .pipe(Effect.mapError(() => new BadRequest({ message: "Encryption failed" })));

          const id = crypto.randomUUID();
          const r2Key = `asc-api-keys/${ctx.organizationId}/${id}.p8.enc`;
          yield* r2Operation(async () =>
            env.CREDENTIAL_ARTIFACTS.put(r2Key, encrypted.encryptedBlob),
          );

          const rolesJson = JSON.stringify(payload.roles ?? []);
          const now = new Date().toISOString();
          yield* withR2Compensation(
            env.CREDENTIAL_ARTIFACTS,
            r2Key,
            repo.insert({
              id,
              organizationId: ctx.organizationId,
              appleTeamId: teamId,
              keyId: payload.keyId,
              name: payload.name,
              roles: rolesJson,
              issuerIdEncrypted: issuer.encrypted,
              issuerIdKeyVersion: issuer.keyVersion,
              r2Key,
              encryptedDek: encrypted.encryptedDek,
              dekKeyVersion: encrypted.keyVersion,
              createdAt: now,
              updatedAt: now,
            }),
          );

          yield* logAudit({
            action: "apple.asc-api-key.upload",
            resourceType: "appleCredential",
            resourceId: id,
            metadata: { keyId: payload.keyId, name: payload.name },
          });

          return toApiAscApiKey({
            id,
            organizationId: ctx.organizationId,
            appleTeamId: teamId,
            keyId: payload.keyId,
            name: payload.name,
            roles: rolesJson,
            issuerIdEncrypted: issuer.encrypted,
            issuerIdKeyVersion: issuer.keyVersion,
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
          yield* assertPermission("appleCredential", "delete");
          const env = yield* cloudflareEnv;
          const repo = yield* AscApiKeyRepo;
          const existing = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(existing.organizationId);
          const { r2Key } = yield* repo.delete({ id: path.id });
          if (r2Key !== null) {
            yield* Effect.promise(async () => env.CREDENTIAL_ARTIFACTS.delete(r2Key));
          }
          yield* logAudit({
            action: "apple.asc-api-key.delete",
            resourceType: "appleCredential",
            resourceId: path.id,
            metadata: { keyId: existing.keyId, name: existing.name },
          });
          return { deleted: 1 };
        }),
      ),
    )
    .handle("syncDevices", ({ path }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          yield* assertPermission("device", "create");
          const ctx = yield* CurrentActor;
          const env = yield* cloudflareEnv;
          const vault = yield* Vault;
          const teams = yield* AppleTeamRepo;
          const repo = yield* AscApiKeyRepo;

          const key = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(key.organizationId);
          if (key.appleTeamId === null) {
            return yield* Effect.fail(
              new BadRequest({
                message: "ASC API key has no Apple team; assign a team before syncing",
              }),
            );
          }

          const team = yield* teams
            .findById({ id: key.appleTeamId })
            .pipe(Effect.mapError(() => new NotFound({ message: "Apple team not found" })));

          const issuerId = yield* vault
            .decryptSecret({
              organizationId: ctx.organizationId,
              keyVersion: key.issuerIdKeyVersion,
              encrypted: key.issuerIdEncrypted,
            })
            .pipe(Effect.mapError(() => new BadRequest({ message: "Decryption failed" })));

          const blob = yield* Effect.promise(async () => env.CREDENTIAL_ARTIFACTS.get(key.r2Key));
          if (blob === null) {
            return yield* Effect.fail(
              new NotFound({ message: "ASC API key artifact missing from R2" }),
            );
          }
          const encryptedBytes = new Uint8Array(
            yield* Effect.promise(async () => blob.arrayBuffer()),
          );
          const pemBytes = yield* vault
            .envelopeDecrypt({
              organizationId: ctx.organizationId,
              keyVersion: key.dekKeyVersion,
              encryptedDek: key.encryptedDek,
              encryptedBlob: encryptedBytes,
            })
            .pipe(Effect.mapError(() => new BadRequest({ message: "Decryption failed" })));
          const p8Pem = new TextDecoder().decode(pemBytes);

          const result = yield* syncDevices({
            organizationId: ctx.organizationId,
            appleTeamId: team.id,
            credentials: {
              teamIdentifier: team.appleTeamId,
              keyId: key.keyId,
              issuerId,
              p8Pem,
            },
          }).pipe(
            Effect.mapError(
              (error) =>
                new BadRequest({
                  message: `Apple sync failed: ${error._tag}`,
                }),
            ),
          );

          yield* logAudit({
            action: "apple.asc-api-key.sync-devices",
            resourceType: "appleCredential",
            resourceId: key.id,
            metadata: { pulled: result.pulled, pushed: result.pushed, skipped: result.skipped },
          });

          return result;
        }),
      ),
    ),
);
