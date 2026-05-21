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
import { toApiApplePushKey } from "../http/to-api";
import {
  toApiBadRequestReadEffect,
  toApiCrudEffect,
  toApiWriteEffect,
} from "../http/to-api-effect";
import { toDbNull } from "../lib/nullable";
import { withR2Compensation } from "../lib/r2-helpers";
import { ApplePushKeyRepo } from "../repositories/apple-push-keys";
import { AppleTeamRepo } from "../repositories/apple-teams";

const decodeBase64 = (value: string) =>
  Effect.try({
    try: () => fromBase64(value),
    catch: () => new BadRequest({ message: "Push key must be valid base64" }),
  });

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
            const artifacts = yield* CredentialArtifacts;
            const teams = yield* AppleTeamRepo;
            const repo = yield* ApplePushKeyRepo;

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

            const r2Key = `apple-push-keys/${ctx.organizationId}/${crypto.randomUUID()}.p8.enc`;
            yield* artifacts.put(r2Key, blob);

            const now = new Date().toISOString();
            yield* withR2Compensation(
              artifacts.delete(r2Key),
              repo.insert({
                id: payload.id,
                organizationId: ctx.organizationId,
                appleTeamId: team.id,
                keyId: payload.keyId,
                r2Key,
                wrappedDek: payload.wrappedDek,
                vaultVersion: payload.vaultVersion,
                createdAt: now,
                updatedAt: now,
              }),
            );

            yield* logAudit({
              action: "apple.push-key.upload",
              resourceType: "appleCredential",
              resourceId: payload.id,
              metadata: { keyId: payload.keyId, appleTeamId: payload.appleTeamIdentifier },
            });

            return toApiApplePushKey({
              id: payload.id,
              organizationId: ctx.organizationId,
              appleTeamId: team.id,
              keyId: payload.keyId,
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
            const repo = yield* ApplePushKeyRepo;
            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);
            const { r2Key } = yield* repo.delete({ id: path.id });
            if (r2Key !== null) {
              yield* artifacts.delete(r2Key);
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
      )
      .handle("download", ({ path }) =>
        toApiBadRequestReadEffect(
          Effect.gen(function* () {
            yield* assertPermission("appleCredential", "download");
            const repo = yield* ApplePushKeyRepo;
            const teams = yield* AppleTeamRepo;
            const artifacts = yield* CredentialArtifacts;

            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);
            const team = yield* teams.findById({ id: existing.appleTeamId });

            const blob = yield* artifacts.get(existing.r2Key, "Push key");

            yield* logAudit({
              action: "apple.push-key.download",
              resourceType: "appleCredential",
              resourceId: path.id,
              metadata: { keyId: existing.keyId },
            });

            return {
              id: existing.id,
              ciphertext: toBase64(blob),
              wrappedDek: existing.wrappedDek,
              vaultVersion: existing.vaultVersion,
              keyId: existing.keyId,
              appleTeamIdentifier: team.appleTeamId,
            };
          }),
        ),
      ),
);
