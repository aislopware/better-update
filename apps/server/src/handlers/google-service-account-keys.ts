import { fromBase64, toBase64 } from "@better-update/encoding";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { assertVaultVersionCurrent } from "../application/assert-vault-version";
import { assertBindableProject, autoBindCredential } from "../application/auto-bind-credential";
import { logAudit } from "../audit/logger";
import {
  assertAndroidOrgCredentialAccess,
  assertAndroidOrgCredentialCreate,
  filterAndroidOrgCredentialRead,
} from "../auth/android-credential-access";
import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership } from "../auth/ownership";
import { assertAccessAny, assertOrgAdmin } from "../auth/policy";
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
import { ProjectCredentialBindingRepo } from "../repositories/project-credential-bindings";

const decodeBase64 = (value: string) =>
  Effect.try({
    try: () => fromBase64(value),
    catch: () => new BadRequest({ message: "Service account key must be valid base64" }),
  });

// Toggle the protected-credential flag (GITLAB-RBAC-SPEC §3b) — org admin
// only, idempotent, audit-logged.
const setProtectionEffect = (id: string, isProtected: boolean) =>
  toApiCrudEffect(
    Effect.gen(function* () {
      const repo = yield* GoogleServiceAccountKeyRepo;
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
        action: isProtected
          ? "google.service-account-key.protect"
          : "google.service-account-key.unprotect",
        resourceType: "androidCredential",
        resourceId: id,
        metadata: { privateKeyId: existing.privateKeyId },
      });
      const bound = yield* ProjectCredentialBindingRepo.pipe(
        Effect.flatMap((bindings) =>
          bindings.boundProjectIds({
            organizationId: ctx.organizationId,
            resourceType: "googleServiceAccountKey",
            resourceId: id,
          }),
        ),
      );
      return toApiGoogleServiceAccountKey({ ...existing, isProtected }, bound);
    }),
  );

export const GoogleServiceAccountKeysGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "googleServiceAccountKeys",
  (handlers) =>
    handlers
      .handle("list", () =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertAccessAny("androidCredential", "read");
            const ctx = yield* CurrentActor;
            const repo = yield* GoogleServiceAccountKeyRepo;
            const items = yield* repo.listByOrg({ organizationId: ctx.organizationId });
            // Binding gate (spec §1a) + protected ladder (spec §3b), per row.
            const visible = yield* filterAndroidOrgCredentialRead(
              items,
              "googleServiceAccountKey",
              (item) => ({ id: item.id, isProtected: item.isProtected }),
            );
            const bindings = yield* ProjectCredentialBindingRepo.pipe(
              Effect.flatMap((repo_) =>
                repo_.boundProjectIdsByResource({
                  organizationId: ctx.organizationId,
                  resourceType: "googleServiceAccountKey",
                }),
              ),
            );
            return {
              items: visible.map((item) =>
                toApiGoogleServiceAccountKey(item, bindings[item.id] ?? []),
              ),
            };
          }),
        ),
      )
      .handle("upload", ({ payload }) =>
        toApiWriteEffect(
          Effect.gen(function* () {
            yield* assertAndroidOrgCredentialCreate({ projectId: payload.projectId });
            yield* assertBindableProject(payload.projectId);
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

            yield* autoBindCredential({
              resourceType: "googleServiceAccountKey",
              resourceId: payload.id,
              projectId: payload.projectId,
            });

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

            return toApiGoogleServiceAccountKey(
              {
                id: payload.id,
                organizationId: ctx.organizationId,
                clientEmail: payload.clientEmail,
                privateKeyId: payload.privateKeyId,
                googleProjectId: payload.googleProjectId,
                clientId,
                r2Key,
                wrappedDek: payload.wrappedDek,
                vaultVersion: payload.vaultVersion,
                isProtected: false,
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
            const repo = yield* GoogleServiceAccountKeyRepo;
            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);
            yield* assertAndroidOrgCredentialAccess({
              action: "delete",
              resourceType: "googleServiceAccountKey",
              resourceId: existing.id,
              isProtected: existing.isProtected,
            });
            const { r2Key } = yield* repo.delete({ id: path.id });
            if (r2Key !== null) {
              yield* artifacts.delete(r2Key);
            }
            // Binding rows die with the credential.
            yield* ProjectCredentialBindingRepo.pipe(
              Effect.flatMap((bindings) =>
                bindings.removeAllForResource({
                  organizationId: existing.organizationId,
                  resourceType: "googleServiceAccountKey",
                  resourceId: existing.id,
                }),
              ),
            );
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
      .handle("protect", ({ path }) => setProtectionEffect(path.id, true))
      .handle("unprotect", ({ path }) => setProtectionEffect(path.id, false))
      .handle("download", ({ path }) =>
        toApiBadRequestReadEffect(
          Effect.gen(function* () {
            const repo = yield* GoogleServiceAccountKeyRepo;
            const artifacts = yield* CredentialArtifacts;

            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);
            yield* assertAndroidOrgCredentialAccess({
              action: "download",
              resourceType: "googleServiceAccountKey",
              resourceId: existing.id,
              isProtected: existing.isProtected,
            });

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
