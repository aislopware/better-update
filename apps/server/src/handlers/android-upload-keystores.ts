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
import { toApiAndroidUploadKeystore } from "../http/to-api";
import {
  toApiBadRequestReadEffect,
  toApiCrudEffect,
  toApiWriteEffect,
} from "../http/to-api-effect";
import { toDbNull } from "../lib/nullable";
import { withR2Compensation } from "../lib/r2-helpers";
import { AndroidUploadKeystoreRepo } from "../repositories/android-upload-keystores";

const decodeBase64 = (value: string) =>
  Effect.try({
    try: () => fromBase64(value),
    catch: () => new BadRequest({ message: "Keystore must be valid base64" }),
  });

export const AndroidUploadKeystoresGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "androidUploadKeystores",
  (handlers) =>
    handlers
      .handle("list", () =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertPermission("androidCredential", "read");
            const ctx = yield* CurrentActor;
            const repo = yield* AndroidUploadKeystoreRepo;
            const items = yield* repo.listByOrg({ organizationId: ctx.organizationId });
            return { items: items.map(toApiAndroidUploadKeystore) };
          }),
        ),
      )
      .handle("upload", ({ payload }) =>
        toApiWriteEffect(
          Effect.gen(function* () {
            yield* assertPermission("androidCredential", "create");
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

            const md5Fingerprint = toDbNull(payload.md5Fingerprint);
            const sha1Fingerprint = toDbNull(payload.sha1Fingerprint);
            const sha256Fingerprint = toDbNull(payload.sha256Fingerprint);
            const now = new Date().toISOString();
            yield* withR2Compensation(
              artifacts.delete(r2Key),
              repo.insert({
                id: payload.id,
                organizationId: ctx.organizationId,
                keyAlias: payload.keyAlias,
                r2Key,
                wrappedDek: payload.wrappedDek,
                vaultVersion: payload.vaultVersion,
                md5Fingerprint,
                sha1Fingerprint,
                sha256Fingerprint,
                createdAt: now,
                updatedAt: now,
              }),
            );

            yield* logAudit({
              action: "android.upload-keystore.upload",
              resourceType: "androidCredential",
              resourceId: payload.id,
              metadata: { keyAlias: payload.keyAlias },
            });

            return toApiAndroidUploadKeystore({
              id: payload.id,
              organizationId: ctx.organizationId,
              keyAlias: payload.keyAlias,
              r2Key,
              wrappedDek: payload.wrappedDek,
              vaultVersion: payload.vaultVersion,
              md5Fingerprint,
              sha1Fingerprint,
              sha256Fingerprint,
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
            const repo = yield* AndroidUploadKeystoreRepo;
            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);
            const { r2Key } = yield* repo.delete({ id: path.id });
            if (r2Key !== null) {
              yield* artifacts.delete(r2Key);
            }
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
      .handle("download", ({ path }) =>
        toApiBadRequestReadEffect(
          Effect.gen(function* () {
            yield* assertPermission("androidCredential", "download");
            const repo = yield* AndroidUploadKeystoreRepo;
            const artifacts = yield* CredentialArtifacts;

            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);

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
