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
import { BadRequest, NotFound } from "../errors";
import { toApiAscApiKey } from "../http/to-api";
import {
  toApiBadRequestReadEffect,
  toApiCrudEffect,
  toApiWriteEffect,
} from "../http/to-api-effect";
import { toDbNull } from "../lib/nullable";
import { withR2Compensation } from "../lib/r2-helpers";
import { AppleTeamRepo } from "../repositories/apple-teams";
import { AscApiKeyRepo } from "../repositories/asc-api-keys";

const decodeBase64 = (value: string) =>
  Effect.try({
    try: () => fromBase64(value),
    catch: () => new BadRequest({ message: "ASC API key must be valid base64" }),
  });

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
          const artifacts = yield* CredentialArtifacts;
          const teams = yield* AppleTeamRepo;
          const repo = yield* AscApiKeyRepo;

          yield* assertVaultVersionCurrent({
            organizationId: ctx.organizationId,
            vaultVersion: payload.vaultVersion,
          });

          const blob = yield* decodeBase64(payload.ciphertext);

          const teamId = payload.appleTeamIdentifier
            ? (yield* teams.upsertByAppleTeamId({
                organizationId: ctx.organizationId,
                appleTeamId: payload.appleTeamIdentifier,
                appleTeamType: payload.appleTeamType ?? "COMPANY_ORGANIZATION",
                name: toDbNull(payload.appleTeamName),
              })).id
            : null;

          const r2Key = `asc-api-keys/${ctx.organizationId}/${crypto.randomUUID()}.p8.enc`;
          yield* artifacts.put(r2Key, blob);

          const rolesJson = JSON.stringify(payload.roles ?? []);
          const now = new Date().toISOString();
          yield* withR2Compensation(
            artifacts.delete(r2Key),
            repo.insert({
              id: payload.id,
              organizationId: ctx.organizationId,
              appleTeamId: teamId,
              keyId: payload.keyId,
              issuerId: payload.issuerId,
              name: payload.name,
              roles: rolesJson,
              r2Key,
              wrappedDek: payload.wrappedDek,
              vaultVersion: payload.vaultVersion,
              createdAt: now,
              updatedAt: now,
            }),
          );

          yield* logAudit({
            action: "apple.asc-api-key.upload",
            resourceType: "appleCredential",
            resourceId: payload.id,
            metadata: { keyId: payload.keyId, name: payload.name },
          });

          return toApiAscApiKey({
            id: payload.id,
            organizationId: ctx.organizationId,
            appleTeamId: teamId,
            keyId: payload.keyId,
            issuerId: payload.issuerId,
            name: payload.name,
            roles: rolesJson,
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
          const repo = yield* AscApiKeyRepo;
          const existing = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(existing.organizationId);
          const { r2Key } = yield* repo.delete({ id: path.id });
          if (r2Key !== null) {
            yield* artifacts.delete(r2Key);
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
    .handle("getCredentials", ({ path }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertPermission("appleCredential", "download");
          const teams = yield* AppleTeamRepo;
          const repo = yield* AscApiKeyRepo;
          const artifacts = yield* CredentialArtifacts;

          const key = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(key.organizationId);

          const teamIdentifier =
            key.appleTeamId === null
              ? null
              : (yield* teams
                  .findById({ id: key.appleTeamId })
                  .pipe(Effect.mapError(() => new NotFound({ message: "Apple team not found" }))))
                  .appleTeamId;

          const blob = yield* artifacts.get(key.r2Key, "ASC API key");

          yield* logAudit({
            action: "apple.asc-api-key.download-credentials",
            resourceType: "appleCredential",
            resourceId: key.id,
            metadata: { keyId: key.keyId, hasAppleTeam: key.appleTeamId !== null },
          });

          return {
            ascApiKeyId: key.id,
            ciphertext: toBase64(blob),
            wrappedDek: key.wrappedDek,
            vaultVersion: key.vaultVersion,
            keyId: key.keyId,
            issuerId: key.issuerId,
            appleTeamIdentifier: teamIdentifier,
          };
        }),
      ),
    ),
);
