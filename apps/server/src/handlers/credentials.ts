import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership, assertProjectOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { BuildRuntime } from "../cloudflare/build-runtime";
import { Vault } from "../cloudflare/vault";
import { BadRequest, Forbidden, NotFound } from "../errors";
import { toApiCredential } from "../http/to-api";
import { toApiBadRequestReadEffect } from "../http/to-api-effect";
import { fromBase64, toBase64 } from "../lib/base64";
import { CredentialRepo } from "../repositories/credentials";

const FILENAME_MAP: Record<string, { filename: string; contentType: string }> = {
  "distribution-certificate": { filename: "cert.p12", contentType: "application/x-pkcs12" },
  "provisioning-profile": {
    filename: "profile.mobileprovision",
    contentType: "application/x-apple-aspen-config",
  },
  "push-key": { filename: "push-key.p8", contentType: "application/x-pem-file" },
  keystore: { filename: "keystore.jks", contentType: "application/x-java-keystore" },
  "play-service-account": {
    filename: "service-account.json",
    contentType: "application/json",
  },
};

const vaultBadRequest = (message: string) => new BadRequest({ message });

const encryptOptionalSecret = (orgId: string, value: string | undefined) =>
  value
    ? Effect.gen(function* () {
        const vault = yield* Vault;
        const result = yield* vault
          .encryptSecret({ organizationId: orgId, value })
          .pipe(Effect.mapError(() => vaultBadRequest("Failed to encrypt credential secret")));
        return result.encrypted;
      })
    : Effect.succeed(null as string | null);

const decryptOptionalSecret = (orgId: string, keyVersion: number, encrypted: string | null) =>
  encrypted
    ? Effect.gen(function* () {
        const vault = yield* Vault;
        return yield* vault
          .decryptSecret({ organizationId: orgId, keyVersion, encrypted })
          .pipe(Effect.mapError(() => vaultBadRequest("Failed to decrypt credential secret")));
      })
    : Effect.succeed(null as string | null);

export const CredentialsGroupLive = HttpApiBuilder.group(ManagementApi, "credentials", (handlers) =>
  handlers
    .handle("upload", ({ payload }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertPermission("credential", "create");
          const ctx = yield* CurrentActor;
          const runtime = yield* BuildRuntime;

          if (payload.projectId) {
            yield* assertProjectOwnership(payload.projectId);
          }

          if (payload.type === "provisioning-profile" && !payload.distribution) {
            return yield* new BadRequest({
              message: "distribution is required for provisioning profiles",
            });
          }

          const blobBytes = fromBase64(payload.blob);

          const vault = yield* Vault;
          const { encryptedBlob, encryptedDek, keyVersion } = yield* vault
            .envelopeEncrypt({
              organizationId: ctx.organizationId,
              plaintext: blobBytes,
            })
            .pipe(Effect.mapError(() => vaultBadRequest("Failed to encrypt credential blob")));

          const [encryptedPassword, encryptedKeyAlias, encryptedKeyPassword] = yield* Effect.all(
            [
              encryptOptionalSecret(ctx.organizationId, payload.password),
              encryptOptionalSecret(ctx.organizationId, payload.keyAlias),
              encryptOptionalSecret(ctx.organizationId, payload.keyPassword),
            ],
            { concurrency: "unbounded" },
          );

          const credentialId = crypto.randomUUID();
          const r2Key = `credentials/${ctx.organizationId}/${credentialId}`;

          yield* runtime.putObject({
            key: r2Key,
            body: encryptedBlob,
            contentType: "application/octet-stream",
          });

          const repo = yield* CredentialRepo;
          const credential = yield* repo.insert({
            id: credentialId,
            organizationId: ctx.organizationId,
            projectId: payload.projectId ?? null,
            platform: payload.platform,
            type: payload.type,
            name: payload.name,
            distribution: payload.distribution ?? null,
            r2Key,
            encryptedDek,
            keyVersion,
            encryptedPassword,
            encryptedKeyAlias,
            encryptedKeyPassword,
            metadataJson: payload.metadata ?? "{}",
            expiresAt: payload.expiresAt ?? null,
          });

          yield* logAudit({
            action: "credential.upload",
            resourceType: "credential",
            resourceId: credential.id,
            metadata: { type: payload.type, platform: payload.platform, name: payload.name },
          });

          return toApiCredential(credential);
        }),
      ),
    )
    .handle("list", ({ urlParams }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertPermission("credential", "read");
          const ctx = yield* CurrentActor;
          const repo = yield* CredentialRepo;

          const page = urlParams.page ?? 1;
          const limit = urlParams.limit ?? 20;
          const offset = (page - 1) * limit;

          const { items, total } = yield* repo.list({
            organizationId: ctx.organizationId,
            ...(urlParams.projectId ? { projectId: urlParams.projectId } : {}),
            ...(urlParams.platform ? { platform: urlParams.platform } : {}),
            ...(urlParams.type ? { type: urlParams.type } : {}),
            ...(urlParams.distribution ? { distribution: urlParams.distribution } : {}),
            limit,
            offset,
          });

          return { items: items.map(toApiCredential), total, page, limit };
        }),
      ),
    )
    .handle("get", ({ path }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertPermission("credential", "read");

          const repo = yield* CredentialRepo;
          const credential = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(credential.organizationId);

          return toApiCredential(credential);
        }),
      ),
    )
    .handle("download", ({ path }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          const ctx = yield* CurrentActor;
          if (ctx.source !== "api-key") {
            return yield* new Forbidden({
              message: "This endpoint requires API key authentication",
            });
          }

          yield* assertPermission("credential", "download");

          const repo = yield* CredentialRepo;
          const encData = yield* repo.findEncryptionData({ id: path.id });
          yield* assertOrgOwnership(encData.organizationId);

          const runtime = yield* BuildRuntime;
          const vault = yield* Vault;
          const r2Object = yield* runtime.getObject({ key: encData.r2Key });
          if (!r2Object) {
            return yield* Effect.fail(
              new NotFound({ message: "Credential blob not found in storage" }),
            );
          }

          const encryptedBlobBytes = yield* Effect.tryPromise({
            try: async () =>
              new Uint8Array(await new Response(r2Object.body ?? new Uint8Array()).arrayBuffer()),
            catch: () => vaultBadRequest("Failed to read credential blob"),
          });

          const plaintext = yield* vault
            .envelopeDecrypt({
              organizationId: encData.organizationId,
              keyVersion: encData.keyVersion,
              encryptedDek: encData.encryptedDek,
              encryptedBlob: encryptedBlobBytes,
            })
            .pipe(Effect.mapError(() => vaultBadRequest("Failed to decrypt credential blob")));

          const [password, keyAlias, keyPassword] = yield* Effect.all(
            [
              decryptOptionalSecret(
                encData.organizationId,
                encData.keyVersion,
                encData.encryptedPassword,
              ),
              decryptOptionalSecret(
                encData.organizationId,
                encData.keyVersion,
                encData.encryptedKeyAlias,
              ),
              decryptOptionalSecret(
                encData.organizationId,
                encData.keyVersion,
                encData.encryptedKeyPassword,
              ),
            ],
            { concurrency: "unbounded" },
          );

          const fileInfo = FILENAME_MAP[encData.type] ?? {
            filename: "credential",
            contentType: "application/octet-stream",
          };

          yield* logAudit({
            action: "credential.download",
            resourceType: "credential",
            resourceId: path.id,
          });

          return {
            blob: toBase64(plaintext),
            password,
            keyAlias,
            keyPassword,
            filename: fileInfo.filename,
            contentType: fileInfo.contentType,
          };
        }),
      ),
    )
    .handle("activate", ({ path }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertPermission("credential", "update");

          const repo = yield* CredentialRepo;
          const credential = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(credential.organizationId);

          const activated = yield* repo.activate({
            id: path.id,
            organizationId: credential.organizationId,
            projectId: credential.projectId,
            platform: credential.platform,
            type: credential.type,
            distribution: credential.distribution,
          });

          yield* logAudit({
            action: "credential.activate",
            resourceType: "credential",
            resourceId: path.id,
          });

          return toApiCredential(activated);
        }),
      ),
    )
    .handle("delete", ({ path }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertPermission("credential", "delete");

          const repo = yield* CredentialRepo;
          const credential = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(credential.organizationId);

          const { r2Key } = yield* repo.deleteById({ id: path.id });

          if (r2Key) {
            const runtime = yield* BuildRuntime;
            yield* runtime
              .deleteObjects({ keys: [r2Key] })
              .pipe(Effect.catchAll(() => Effect.void));
          }

          yield* logAudit({
            action: "credential.delete",
            resourceType: "credential",
            resourceId: path.id,
          });

          return { id: path.id };
        }),
      ),
    ),
);
