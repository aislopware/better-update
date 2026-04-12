import { AuthContext, BadRequest, Forbidden, NotFound } from "@better-update/api";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { assertOrgOwnership, assertProjectOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { cloudflareEnv } from "../cloudflare/context";
import {
  decryptSecret,
  envelopeDecrypt,
  envelopeEncrypt,
  encryptSecret,
  fromBase64,
  resolveKeyring,
  toBase64,
} from "../domain/credential-vault";
import { CredentialRepo } from "../repositories/credentials";

import type { Keyring } from "../domain/credential-vault";

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

const encryptOptionalSecret = (keyring: Keyring, orgId: string, value: string | undefined) =>
  value
    ? Effect.promise(async () => encryptSecret(keyring, orgId, value)).pipe(
        Effect.map((result) => result.encrypted),
      )
    : Effect.succeed(null as string | null);

const decryptOptionalSecret = (
  keyring: Keyring,
  orgId: string,
  keyVersion: number,
  encrypted: string | null,
) =>
  encrypted
    ? Effect.promise(async () => decryptSecret(keyring, orgId, keyVersion, encrypted))
    : Effect.succeed(null as string | null);

export const CredentialsGroupLive = HttpApiBuilder.group(ManagementApi, "credentials", (handlers) =>
  handlers
    .handle("upload", ({ payload }) =>
      Effect.gen(function* () {
        yield* assertPermission("credential", "create");
        const ctx = yield* AuthContext;
        const env = yield* cloudflareEnv;

        if (payload.projectId) {
          yield* assertProjectOwnership(payload.projectId);
        }

        if (payload.type === "provisioning-profile" && !payload.distribution) {
          return yield* new BadRequest({
            message: "distribution is required for provisioning profiles",
          });
        }

        const keyring = yield* Effect.try({
          try: () => resolveKeyring(env.VAULT_KEYRING),
          catch: () => new BadRequest({ message: "Vault keyring is not configured" }),
        });
        const blobBytes = fromBase64(payload.blob);

        const { encryptedBlob, encryptedDek, keyVersion } = yield* Effect.promise(async () =>
          envelopeEncrypt(keyring, ctx.organizationId, blobBytes),
        );

        const [encryptedPassword, encryptedKeyAlias, encryptedKeyPassword] = yield* Effect.all(
          [
            encryptOptionalSecret(keyring, ctx.organizationId, payload.password),
            encryptOptionalSecret(keyring, ctx.organizationId, payload.keyAlias),
            encryptOptionalSecret(keyring, ctx.organizationId, payload.keyPassword),
          ],
          { concurrency: "unbounded" },
        );

        const credentialId = crypto.randomUUID();
        const r2Key = `credentials/${ctx.organizationId}/${credentialId}`;

        yield* Effect.promise(async () => env.BUILD_BUCKET.put(r2Key, encryptedBlob));

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

        return credential;
      }),
    )
    .handle("list", ({ urlParams }) =>
      Effect.gen(function* () {
        yield* assertPermission("credential", "read");
        const ctx = yield* AuthContext;
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

        return { items, total, page, limit };
      }),
    )
    .handle("get", ({ path }) =>
      Effect.gen(function* () {
        yield* assertPermission("credential", "read");

        const repo = yield* CredentialRepo;
        const credential = yield* repo.findById({ id: path.id });
        yield* assertOrgOwnership(credential.organizationId);

        return credential;
      }),
    )
    .handle("download", ({ path }) =>
      Effect.gen(function* () {
        const ctx = yield* AuthContext;
        if (ctx.source !== "api-key") {
          return yield* new Forbidden({
            message: "This endpoint requires API key authentication",
          });
        }

        yield* assertPermission("credential", "download");

        const repo = yield* CredentialRepo;
        const encData = yield* repo.findEncryptionData({ id: path.id });
        yield* assertOrgOwnership(encData.organizationId);

        const env = yield* cloudflareEnv;
        const keyring = yield* Effect.try({
          try: () => resolveKeyring(env.VAULT_KEYRING),
          catch: () => new BadRequest({ message: "Vault keyring is not configured" }),
        });

        const r2Object = yield* Effect.promise(async () => env.BUILD_BUCKET.get(encData.r2Key));
        if (!r2Object) {
          return yield* Effect.fail(
            new NotFound({ message: "Credential blob not found in storage" }),
          );
        }

        const encryptedBlobBytes = yield* Effect.promise(
          async () => new Uint8Array(await r2Object.arrayBuffer()),
        );

        const plaintext = yield* Effect.promise(async () =>
          envelopeDecrypt(
            keyring,
            encData.organizationId,
            encData.keyVersion,
            encData.encryptedDek,
            encryptedBlobBytes,
          ),
        );

        const [password, keyAlias, keyPassword] = yield* Effect.all(
          [
            decryptOptionalSecret(
              keyring,
              encData.organizationId,
              encData.keyVersion,
              encData.encryptedPassword,
            ),
            decryptOptionalSecret(
              keyring,
              encData.organizationId,
              encData.keyVersion,
              encData.encryptedKeyAlias,
            ),
            decryptOptionalSecret(
              keyring,
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
    )
    .handle("activate", ({ path }) =>
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

        return activated;
      }),
    )
    .handle("delete", ({ path }) =>
      Effect.gen(function* () {
        yield* assertPermission("credential", "delete");

        const repo = yield* CredentialRepo;
        const credential = yield* repo.findById({ id: path.id });
        yield* assertOrgOwnership(credential.organizationId);

        const { r2Key } = yield* repo.deleteById({ id: path.id });

        if (r2Key) {
          const env = yield* cloudflareEnv;
          yield* Effect.promise(async () => env.BUILD_BUCKET.delete(r2Key)).pipe(
            Effect.catchAll(() => Effect.void),
          );
        }

        yield* logAudit({
          action: "credential.delete",
          resourceType: "credential",
          resourceId: path.id,
        });

        return { id: path.id };
      }),
    ),
);
