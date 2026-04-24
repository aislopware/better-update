import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { cloudflareEnv } from "../cloudflare/context";
import { Vault } from "../cloudflare/vault";
import { validatePushKey } from "../domain/apple-push-key-validator";
import { BadRequest } from "../errors";
import { toApiApplePushKey } from "../http/to-api";
import { toApiCrudEffect, toApiWriteEffect } from "../http/to-api-effect";
import { toDbNull } from "../lib/nullable";
import { r2Operation, withR2Compensation } from "../lib/r2-helpers";
import { ApplePushKeyRepo } from "../repositories/apple-push-keys";
import { AppleTeamRepo } from "../repositories/apple-teams";

import type { InvalidApplePushKey } from "../domain/apple-push-key-validator";

const mapInvalid = (error: InvalidApplePushKey) => new BadRequest({ message: error.message });

export const ApplePushKeysGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "applePushKeys",
  (handlers) =>
    handlers
      .handle("list", () =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertPermission("appleCredential", "read");
            const ctx = yield* CurrentActor;
            const repo = yield* ApplePushKeyRepo;
            const items = yield* repo.listByOrg({ organizationId: ctx.organizationId });
            return { items: items.map(toApiApplePushKey) };
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
            const repo = yield* ApplePushKeyRepo;

            yield* validatePushKey({
              keyId: payload.keyId,
              appleTeamId: payload.appleTeamIdentifier,
              pem: payload.p8Pem,
            }).pipe(Effect.mapError(mapInvalid));

            const team = yield* teams.upsertByAppleTeamId({
              organizationId: ctx.organizationId,
              appleTeamId: payload.appleTeamIdentifier,
              appleTeamType: payload.appleTeamType ?? "COMPANY_ORGANIZATION",
              name: toDbNull(payload.appleTeamName),
            });

            const plaintext = new TextEncoder().encode(payload.p8Pem);
            const encrypted = yield* vault
              .envelopeEncrypt({ organizationId: ctx.organizationId, plaintext })
              .pipe(Effect.mapError(() => new BadRequest({ message: "Encryption failed" })));

            const id = crypto.randomUUID();
            const r2Key = `apple-push-keys/${ctx.organizationId}/${id}.p8.enc`;
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
                keyId: payload.keyId,
                r2Key,
                encryptedDek: encrypted.encryptedDek,
                dekKeyVersion: encrypted.keyVersion,
                createdAt: now,
                updatedAt: now,
              }),
            );

            yield* logAudit({
              action: "apple.push-key.upload",
              resourceType: "appleCredential",
              resourceId: id,
              metadata: { keyId: payload.keyId, appleTeamId: payload.appleTeamIdentifier },
            });

            return toApiApplePushKey({
              id,
              organizationId: ctx.organizationId,
              appleTeamId: team.id,
              keyId: payload.keyId,
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
            const repo = yield* ApplePushKeyRepo;
            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);
            const { r2Key } = yield* repo.delete({ id: path.id });
            if (r2Key !== null) {
              yield* Effect.promise(async () => env.CREDENTIAL_ARTIFACTS.delete(r2Key));
            }
            yield* logAudit({
              action: "apple.push-key.delete",
              resourceType: "appleCredential",
              resourceId: path.id,
              metadata: { keyId: existing.keyId },
            });
            return { deleted: 1 };
          }),
        ),
      ),
);
