import { fromBase64, toBase64 } from "@better-update/encoding";
import { compact } from "@better-update/type-guards";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { CredentialArtifacts } from "../cloudflare/credential-artifacts";
import { Vault } from "../cloudflare/vault";
import { validateAndroidKeystore } from "../domain/android-keystore-parser";
import { BadRequest } from "../errors";
import { toApiAndroidUploadKeystore } from "../http/to-api";
import {
  toApiBadRequestReadEffect,
  toApiCrudEffect,
  toApiWriteEffect,
} from "../http/to-api-effect";
import { withR2Compensation } from "../lib/r2-helpers";
import { AndroidUploadKeystoreRepo } from "../repositories/android-upload-keystores";

import type { InvalidAndroidKeystore } from "../domain/android-keystore-parser";

const mapInvalid = (error: InvalidAndroidKeystore) => new BadRequest({ message: error.message });

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
            const vault = yield* Vault;
            const repo = yield* AndroidUploadKeystoreRepo;

            const bytes = yield* decodeBase64(payload.keystoreBase64);
            const parsed = yield* validateAndroidKeystore({
              bytes,
              keyAlias: payload.keyAlias,
              keystorePassword: payload.keystorePassword,
              keyPassword: payload.keyPassword,
              ...compact({
                md5Fingerprint: payload.md5Fingerprint,
                sha1Fingerprint: payload.sha1Fingerprint,
                sha256Fingerprint: payload.sha256Fingerprint,
              }),
            }).pipe(Effect.mapError(mapInvalid));

            const encrypted = yield* vault
              .envelopeEncrypt({ organizationId: ctx.organizationId, plaintext: bytes })
              .pipe(Effect.mapError(() => new BadRequest({ message: "Encryption failed" })));
            const keystorePass = yield* vault
              .encryptSecret({
                organizationId: ctx.organizationId,
                value: payload.keystorePassword,
              })
              .pipe(Effect.mapError(() => new BadRequest({ message: "Encryption failed" })));
            const keyPass = yield* vault
              .encryptSecret({
                organizationId: ctx.organizationId,
                value: payload.keyPassword,
              })
              .pipe(Effect.mapError(() => new BadRequest({ message: "Encryption failed" })));

            const id = crypto.randomUUID();
            const r2Key = `android-upload-keystores/${ctx.organizationId}/${id}.keystore.enc`;
            yield* artifacts.put(r2Key, encrypted.encryptedBlob);

            const now = new Date().toISOString();
            yield* withR2Compensation(
              artifacts.delete(r2Key),
              repo.insert({
                id,
                organizationId: ctx.organizationId,
                keyAlias: parsed.keyAlias,
                encryptedKeystorePassword: keystorePass.encrypted,
                keystorePasswordKeyVersion: keystorePass.keyVersion,
                encryptedKeyPassword: keyPass.encrypted,
                keyPasswordKeyVersion: keyPass.keyVersion,
                r2Key,
                encryptedDek: encrypted.encryptedDek,
                dekKeyVersion: encrypted.keyVersion,
                md5Fingerprint: parsed.md5Fingerprint,
                sha1Fingerprint: parsed.sha1Fingerprint,
                sha256Fingerprint: parsed.sha256Fingerprint,
                createdAt: now,
                updatedAt: now,
              }),
            );

            yield* logAudit({
              action: "android.upload-keystore.upload",
              resourceType: "androidCredential",
              resourceId: id,
              metadata: { keyAlias: parsed.keyAlias, format: parsed.format },
            });

            return toApiAndroidUploadKeystore({
              id,
              organizationId: ctx.organizationId,
              keyAlias: parsed.keyAlias,
              encryptedKeystorePassword: keystorePass.encrypted,
              keystorePasswordKeyVersion: keystorePass.keyVersion,
              encryptedKeyPassword: keyPass.encrypted,
              keyPasswordKeyVersion: keyPass.keyVersion,
              r2Key,
              encryptedDek: encrypted.encryptedDek,
              dekKeyVersion: encrypted.keyVersion,
              md5Fingerprint: parsed.md5Fingerprint,
              sha1Fingerprint: parsed.sha1Fingerprint,
              sha256Fingerprint: parsed.sha256Fingerprint,
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
            const ctx = yield* CurrentActor;
            const repo = yield* AndroidUploadKeystoreRepo;
            const artifacts = yield* CredentialArtifacts;
            const vault = yield* Vault;

            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);

            const encryptedBlob = yield* artifacts.get(existing.r2Key, "Keystore");
            const keystoreBytes = yield* vault
              .envelopeDecrypt({
                organizationId: ctx.organizationId,
                keyVersion: existing.dekKeyVersion,
                encryptedDek: existing.encryptedDek,
                encryptedBlob,
              })
              .pipe(Effect.mapError(() => new BadRequest({ message: "Decryption failed" })));
            const keystorePassword = yield* vault
              .decryptSecret({
                organizationId: ctx.organizationId,
                keyVersion: existing.keystorePasswordKeyVersion,
                encrypted: existing.encryptedKeystorePassword,
              })
              .pipe(Effect.mapError(() => new BadRequest({ message: "Decryption failed" })));
            const keyPassword = yield* vault
              .decryptSecret({
                organizationId: ctx.organizationId,
                keyVersion: existing.keyPasswordKeyVersion,
                encrypted: existing.encryptedKeyPassword,
              })
              .pipe(Effect.mapError(() => new BadRequest({ message: "Decryption failed" })));

            yield* logAudit({
              action: "android.upload-keystore.download",
              resourceType: "androidCredential",
              resourceId: path.id,
              metadata: { keyAlias: existing.keyAlias },
            });

            return {
              id: existing.id,
              keystoreBase64: toBase64(keystoreBytes),
              keyAlias: existing.keyAlias,
              keystorePassword,
              keyPassword,
            };
          }),
        ),
      ),
);
