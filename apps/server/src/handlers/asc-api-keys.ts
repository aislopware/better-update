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
import { ProjectCredentialBindingRepo } from "../repositories/project-credential-bindings";

const decodeBase64 = (value: string) =>
  Effect.try({
    try: () => fromBase64(value),
    catch: () => new BadRequest({ message: "ASC API key must be valid base64" }),
  });

// Toggle the per-row protected flag (GITLAB-RBAC-SPEC §3b) — org admin only,
// idempotent, audit-logged. The row flag is the whole gate for this key; the
// team flag only guards team-level interactions. Team-less keys are created
// protected.
const setProtectionEffect = (id: string, isProtected: boolean) =>
  toApiCrudEffect(
    Effect.gen(function* () {
      const repo = yield* AscApiKeyRepo;
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
        action: isProtected ? "apple.asc-api-key.protect" : "apple.asc-api-key.unprotect",
        resourceType: "appleCredential",
        resourceId: id,
        metadata: { keyId: existing.keyId, name: existing.name },
      });
      // Response bindings mirror `list`: a team-scoped key surfaces its
      // team's bound projects AND org-wide flag (cascade); a team-less key
      // its own.
      const bindings = yield* ProjectCredentialBindingRepo;
      const bindingRef =
        existing.appleTeamId === null
          ? { resourceType: "ascApiKey" as const, resourceId: existing.id }
          : { resourceType: "appleTeam" as const, resourceId: existing.appleTeamId };
      const bound = yield* bindings.boundProjectIds({
        organizationId: ctx.organizationId,
        ...bindingRef,
      });
      const orgWide = yield* bindings.findAllProjectsBinding({
        organizationId: ctx.organizationId,
        ...bindingRef,
      });
      return toApiAscApiKey({ ...existing, isProtected }, bound, orgWide !== null);
    }),
  );

export const AscApiKeysGroupLive = HttpApiBuilder.group(ManagementApi, "ascApiKeys", (handlers) =>
  handlers
    .handle("list", () =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertAccessAny("appleCredential", "read");
          const ctx = yield* CurrentActor;
          const repo = yield* AscApiKeyRepo;
          const items = yield* repo.listByOrg({ organizationId: ctx.organizationId });
          const visible = yield* filterByAppleTeamRead(
            items,
            (item) => item.appleTeamId,
            (item) => item.isProtected,
            { teamlessBindingIdOf: (item) => item.id },
          );
          // Response bindings: a team-scoped key surfaces its TEAM's bound
          // projects and org-wide flag (cascade); a team-less key its own.
          const bindingsRepo = yield* ProjectCredentialBindingRepo;
          const teamBindings = yield* bindingsRepo.boundProjectIdsByResource({
            organizationId: ctx.organizationId,
            resourceType: "appleTeam",
          });
          const keyBindings = yield* bindingsRepo.boundProjectIdsByResource({
            organizationId: ctx.organizationId,
            resourceType: "ascApiKey",
          });
          const orgWideTeams = new Set(
            yield* bindingsRepo.allProjectsResourceIds({
              organizationId: ctx.organizationId,
              resourceType: "appleTeam",
            }),
          );
          const orgWideKeys = new Set(
            yield* bindingsRepo.allProjectsResourceIds({
              organizationId: ctx.organizationId,
              resourceType: "ascApiKey",
            }),
          );
          return {
            items: visible.map((item) =>
              toApiAscApiKey(
                item,
                item.appleTeamId === null
                  ? (keyBindings[item.id] ?? [])
                  : (teamBindings[item.appleTeamId] ?? []),
                item.appleTeamId === null
                  ? orgWideKeys.has(item.id)
                  : orgWideTeams.has(item.appleTeamId),
              ),
            ),
          };
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
          const repo = yield* AscApiKeyRepo;

          yield* assertVaultVersionCurrent({
            organizationId: ctx.organizationId,
            vaultVersion: payload.vaultVersion,
          });

          const blob = yield* decodeBase64(payload.ciphertext);

          const team = payload.appleTeamIdentifier
            ? yield* teams.upsertByAppleTeamId({
                organizationId: ctx.organizationId,
                appleTeamId: payload.appleTeamIdentifier,
                appleTeamType: payload.appleTeamType ?? "COMPANY_ORGANIZATION",
                name: toDbNull(payload.appleTeamName),
              })
            : null;
          const teamId = team === null ? null : team.id;

          const r2Key = `asc-api-keys/${ctx.organizationId}/${crypto.randomUUID()}.p8.enc`;
          yield* artifacts.put(r2Key, blob);

          const rolesJson = JSON.stringify(payload.roles ?? []);
          // Team-less keys start protected (spec §3b); team-scoped keys
          // snapshot their team's flag. An org admin can toggle afterwards.
          const isProtected = team === null ? true : team.isProtected;
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
              isProtected,
              createdAt: now,
              updatedAt: now,
            }),
          );

          yield* autoBindCredential(
            teamId === null
              ? { resourceType: "ascApiKey", resourceId: payload.id, projectId: payload.projectId }
              : { resourceType: "appleTeam", resourceId: teamId, projectId: payload.projectId },
          );

          yield* logAudit({
            action: "apple.asc-api-key.upload",
            resourceType: "appleCredential",
            resourceId: payload.id,
            metadata: { keyId: payload.keyId, name: payload.name },
          });

          return toApiAscApiKey(
            {
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
              isProtected,
              createdAt: now,
              updatedAt: now,
            },
            payload.projectId === undefined ? [] : [payload.projectId],
          );
        }),
      ),
    )
    .handle("delete", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const artifacts = yield* CredentialArtifacts;
          const repo = yield* AscApiKeyRepo;
          const existing = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(existing.organizationId);
          yield* assertAppleCredentialAccess({
            action: "delete",
            appleTeamRowId: existing.appleTeamId,
            credentialIsProtected: existing.isProtected,
            ascApiKeyId: existing.id,
          });
          const { r2Key } = yield* repo.delete({ id: path.id });
          if (r2Key !== null) {
            yield* artifacts.delete(r2Key);
          }
          // Team-less keys bind individually — their rows die with the key.
          const bindings = yield* ProjectCredentialBindingRepo;
          yield* bindings.removeAllForResource({
            organizationId: existing.organizationId,
            resourceType: "ascApiKey",
            resourceId: existing.id,
          });
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
          yield* assertAppleCredentialAccess({
            action: "download",
            appleTeamRowId: key.appleTeamId,
            credentialIsProtected: key.isProtected,
            ascApiKeyId: key.id,
          });

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
    )
    .handle("protect", ({ path }) => setProtectionEffect(path.id, true))
    .handle("unprotect", ({ path }) => setProtectionEffect(path.id, false)),
);
