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
import { toApiAndroidUploadKeystore } from "../http/to-api";
import {
  toApiBadRequestReadEffect,
  toApiCrudEffect,
  toApiWriteEffect,
} from "../http/to-api-effect";
import { toDbNull } from "../lib/nullable";
import { withR2Compensation } from "../lib/r2-helpers";
import { AndroidUploadKeystoreRepo } from "../repositories/android-upload-keystores";
import { ProjectCredentialBindingRepo } from "../repositories/project-credential-bindings";

const decodeBase64 = (value: string) =>
  Effect.try({
    try: () => fromBase64(value),
    catch: () => new BadRequest({ message: "Keystore must be valid base64" }),
  });

// Toggle the protected-credential flag (GITLAB-RBAC-SPEC §3b) — org admin
// only, idempotent, audit-logged.
const setProtectionEffect = (id: string, isProtected: boolean) =>
  toApiCrudEffect(
    Effect.gen(function* () {
      const repo = yield* AndroidUploadKeystoreRepo;
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
          ? "android.upload-keystore.protect"
          : "android.upload-keystore.unprotect",
        resourceType: "androidCredential",
        resourceId: id,
        metadata: { keyAlias: existing.keyAlias },
      });
      const bindings = yield* ProjectCredentialBindingRepo;
      const bound = yield* bindings.boundProjectIds({
        organizationId: ctx.organizationId,
        resourceType: "androidUploadKeystore",
        resourceId: id,
      });
      const orgWide = yield* bindings.findAllProjectsBinding({
        organizationId: ctx.organizationId,
        resourceType: "androidUploadKeystore",
        resourceId: id,
      });
      return toApiAndroidUploadKeystore({ ...existing, isProtected }, bound, orgWide !== null);
    }),
  );

export const AndroidUploadKeystoresGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "androidUploadKeystores",
  (handlers) =>
    handlers
      .handle("list", () =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertAccessAny("androidCredential", "read");
            const ctx = yield* CurrentActor;
            const repo = yield* AndroidUploadKeystoreRepo;
            const items = yield* repo.listByOrg({ organizationId: ctx.organizationId });
            // Binding gate (spec §1a) + protected ladder (spec §3b), per row.
            const visible = yield* filterAndroidOrgCredentialRead(
              items,
              "androidUploadKeystore",
              (item) => ({ id: item.id, isProtected: item.isProtected }),
            );
            const bindingsRepo = yield* ProjectCredentialBindingRepo;
            const bindings = yield* bindingsRepo.boundProjectIdsByResource({
              organizationId: ctx.organizationId,
              resourceType: "androidUploadKeystore",
            });
            const orgWide = new Set(
              yield* bindingsRepo.allProjectsResourceIds({
                organizationId: ctx.organizationId,
                resourceType: "androidUploadKeystore",
              }),
            );
            return {
              items: visible.map((item) =>
                toApiAndroidUploadKeystore(item, bindings[item.id] ?? [], orgWide.has(item.id)),
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
            const repo = yield* AndroidUploadKeystoreRepo;

            yield* assertVaultVersionCurrent({
              organizationId: ctx.organizationId,
              vaultVersion: payload.vaultVersion,
            });

            const blob = yield* decodeBase64(payload.ciphertext);

            const r2Key = `android-upload-keystores/${ctx.organizationId}/${crypto.randomUUID()}.keystore.enc`;
            yield* artifacts.put(r2Key, blob);

            const name = toDbNull(payload.name);
            const md5Fingerprint = toDbNull(payload.md5Fingerprint);
            const sha1Fingerprint = toDbNull(payload.sha1Fingerprint);
            const sha256Fingerprint = toDbNull(payload.sha256Fingerprint);
            const keystoreType = toDbNull(payload.keystoreType);
            const now = new Date().toISOString();
            yield* withR2Compensation(
              artifacts.delete(r2Key),
              repo.insert({
                id: payload.id,
                organizationId: ctx.organizationId,
                name,
                keyAlias: payload.keyAlias,
                r2Key,
                wrappedDek: payload.wrappedDek,
                vaultVersion: payload.vaultVersion,
                md5Fingerprint,
                sha1Fingerprint,
                sha256Fingerprint,
                keystoreType,
                createdAt: now,
                updatedAt: now,
              }),
            );

            yield* autoBindCredential({
              resourceType: "androidUploadKeystore",
              resourceId: payload.id,
              projectId: payload.projectId,
            });

            yield* logAudit({
              action: "android.upload-keystore.upload",
              resourceType: "androidCredential",
              resourceId: payload.id,
              metadata: { keyAlias: payload.keyAlias },
            });

            return toApiAndroidUploadKeystore(
              {
                id: payload.id,
                organizationId: ctx.organizationId,
                name,
                keyAlias: payload.keyAlias,
                r2Key,
                wrappedDek: payload.wrappedDek,
                vaultVersion: payload.vaultVersion,
                md5Fingerprint,
                sha1Fingerprint,
                sha256Fingerprint,
                keystoreType,
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
            const repo = yield* AndroidUploadKeystoreRepo;
            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);
            yield* assertAndroidOrgCredentialAccess({
              action: "delete",
              resourceType: "androidUploadKeystore",
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
                  resourceType: "androidUploadKeystore",
                  resourceId: existing.id,
                }),
              ),
            );
            yield* logAudit({
              action: "android.upload-keystore.delete",
              resourceType: "androidCredential",
              resourceId: path.id,
              metadata: { keyAlias: existing.keyAlias },
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
            const repo = yield* AndroidUploadKeystoreRepo;
            const artifacts = yield* CredentialArtifacts;

            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);
            yield* assertAndroidOrgCredentialAccess({
              action: "download",
              resourceType: "androidUploadKeystore",
              resourceId: existing.id,
              isProtected: existing.isProtected,
            });

            const blob = yield* artifacts.get(existing.r2Key, "Keystore");

            yield* logAudit({
              action: "android.upload-keystore.download",
              resourceType: "androidCredential",
              resourceId: path.id,
              metadata: { keyAlias: existing.keyAlias },
            });

            return {
              id: existing.id,
              ciphertext: toBase64(blob),
              wrappedDek: existing.wrappedDek,
              vaultVersion: existing.vaultVersion,
              keyAlias: existing.keyAlias,
            };
          }),
        ),
      ),
);
