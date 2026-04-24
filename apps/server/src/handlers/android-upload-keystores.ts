import { fromBase64 } from "@better-update/encoding";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { cloudflareEnv } from "../cloudflare/context";
import { Vault } from "../cloudflare/vault";
import { validateAndroidKeystore } from "../domain/android-keystore-parser";
import { BadRequest } from "../errors";
import { toApiAndroidUploadKeystore } from "../http/to-api";
import { toApiCrudEffect, toApiWriteEffect } from "../http/to-api-effect";
import { r2Operation, withR2Compensation } from "../lib/r2-helpers";
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
            const env = yield* cloudflareEnv;
            const vault = yield* Vault;
            const repo = yield* AndroidUploadKeystoreRepo;

            const bytes = yield* decodeBase64(payload.keystoreBase64);
            const parsed = yield* validateAndroidKeystore({
              bytes,
              keyAlias: payload.keyAlias,
              keystorePassword: payload.keystorePassword,
              keyPassword: payload.keyPassword,
              ...(payload.md5Fingerprint === undefined
                ? {}
                : { md5Fingerprint: payload.md5Fingerprint }),
              ...(payload.sha1Fingerprint === undefined
                ? {}
                : { sha1Fingerprint: payload.sha1Fingerprint }),
              ...(payload.sha256Fingerprint === undefined
                ? {}
                : { sha256Fingerprint: payload.sha256Fingerprint }),
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
            const env = yield* cloudflareEnv;
            const repo = yield* AndroidUploadKeystoreRepo;
            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);
            const { r2Key } = yield* repo.delete({ id: path.id });
            if (r2Key !== null) {
              yield* Effect.promise(async () => env.CREDENTIAL_ARTIFACTS.delete(r2Key));
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
      ),
);
