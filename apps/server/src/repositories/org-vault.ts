import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { Conflict } from "../errors";
import { d1WithUniqueCheck } from "./d1-helpers";

import type {
  CredentialDekRefModel,
  CredentialRef,
  EncryptedCredentialType,
  OrgVaultKeyWrapModel,
  OrgVaultModel,
} from "../models";

export interface OrgVaultRepository {
  /** The org's vault row (version + timestamps), or `null` if not yet bootstrapped. */
  readonly getVault: (params: {
    readonly organizationId: string;
  }) => Effect.Effect<OrgVaultModel | null>;

  /** Atomically create the vault (version 1) with its initial recipient wraps. */
  readonly bootstrap: (params: {
    readonly organizationId: string;
    readonly wraps: readonly {
      readonly userEncryptionKeyId: string;
      readonly wrappedKey: string;
    }[];
    readonly now: string;
  }) => Effect.Effect<OrgVaultModel, Conflict>;

  /** A single recipient's wrap at a given version, or `null` if not granted. */
  readonly findWrap: (params: {
    readonly organizationId: string;
    readonly vaultVersion: number;
    readonly userEncryptionKeyId: string;
  }) => Effect.Effect<OrgVaultKeyWrapModel | null>;

  /**
   * Insert one wrap row, but only if `vaultVersion` still equals the current
   * version (compare-and-swap). A version mismatch fails `Conflict` so the
   * caller re-reads and retries; a duplicate recipient at the version also fails
   * `Conflict`.
   */
  readonly addWrap: (params: {
    readonly organizationId: string;
    readonly vaultVersion: number;
    readonly userEncryptionKeyId: string;
    readonly wrappedKey: string;
    readonly now: string;
  }) => Effect.Effect<OrgVaultKeyWrapModel, Conflict>;

  /** All recipient wraps at a given version (for the Access view + rotation planning). */
  readonly listWraps: (params: {
    readonly organizationId: string;
    readonly vaultVersion: number;
  }) => Effect.Effect<readonly OrgVaultKeyWrapModel[]>;

  /** Every encrypted-credential row in the org (type + id) — the rotation coverage set. */
  readonly listCredentialRefs: (params: {
    readonly organizationId: string;
  }) => Effect.Effect<readonly CredentialRef[]>;

  /** Every wrapped DEK in the org — the source set the client re-wraps in a rotation. */
  readonly listCredentialDeks: (params: {
    readonly organizationId: string;
  }) => Effect.Effect<readonly CredentialDekRefModel[]>;

  /**
   * Atomically rotate the vault key: re-wrap the new key to every surviving
   * recipient, drop the old wraps, re-wrap every credential's DEK, and bump the
   * version `fromVersion → fromVersion + 1` — all guarded by compare-and-swap on
   * `fromVersion`. A lost CAS (a concurrent rotation moved the version) mutates
   * nothing and fails `Conflict`. Covering every credential is the caller's
   * responsibility (validated in the handler against {@link listCredentialRefs}).
   */
  readonly rotate: (params: {
    readonly organizationId: string;
    readonly fromVersion: number;
    readonly recipientWraps: readonly {
      readonly userEncryptionKeyId: string;
      readonly wrappedKey: string;
    }[];
    readonly credentialDeks: readonly {
      readonly credentialType: EncryptedCredentialType;
      readonly credentialId: string;
      readonly wrappedDek: string;
    }[];
    readonly now: string;
  }) => Effect.Effect<OrgVaultModel, Conflict>;
}

export class OrgVaultRepo extends Context.Tag("api/OrgVaultRepo")<
  OrgVaultRepo,
  OrgVaultRepository
>() {}

interface VaultRow {
  organization_id: string;
  vault_version: number;
  created_at: string;
  updated_at: string;
}

interface WrapRow {
  organization_id: string;
  vault_version: number;
  user_encryption_key_id: string;
  wrapped_key: string;
  created_at: string;
}

const WRAP_COLUMNS = `"organization_id", "vault_version", "user_encryption_key_id", "wrapped_key", "created_at"`;

/**
 * The encrypted-credential tables a rotation re-wraps, keyed by the API
 * `CredentialType`. A fixed allowlist — the only values interpolated into the
 * rotation SQL — so the lookup is safe against injection.
 */
const CREDENTIAL_TABLES: Record<EncryptedCredentialType, string> = {
  appleDistributionCertificate: "apple_distribution_certificates",
  applePushKey: "apple_push_keys",
  ascApiKey: "asc_api_keys",
  googleServiceAccountKey: "google_service_account_keys",
  androidUploadKeystore: "android_upload_keystores",
  // Each env var value revision is its own vault-bound secret; rotation re-wraps
  // every revision so rollback stays decryptable and a revoke is total.
  envVarValue: "env_var_revisions",
};

const toVaultModel = (row: VaultRow): OrgVaultModel => ({
  organizationId: row.organization_id,
  vaultVersion: row.vault_version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toWrapModel = (row: WrapRow): OrgVaultKeyWrapModel => ({
  organizationId: row.organization_id,
  vaultVersion: row.vault_version,
  userEncryptionKeyId: row.user_encryption_key_id,
  wrappedKey: row.wrapped_key,
  createdAt: row.created_at,
});

export const OrgVaultRepoLive = Layer.succeed(OrgVaultRepo, {
  getVault: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "organization_id", "vault_version", "created_at", "updated_at" FROM "org_vaults" WHERE "organization_id" = ?`,
        )
          .bind(params.organizationId)
          .first<VaultRow>(),
      );
      return row === null ? null : toVaultModel(row);
    }),

  bootstrap: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const statements = [
        env.DB.prepare(
          `INSERT INTO "org_vaults" ("organization_id", "vault_version", "created_at", "updated_at") VALUES (?, 1, ?, ?)`,
        ).bind(params.organizationId, params.now, params.now),
        ...params.wraps.map((wrap) =>
          env.DB.prepare(
            `INSERT INTO "org_vault_key_wraps" (${WRAP_COLUMNS}) VALUES (?, 1, ?, ?, ?)`,
          ).bind(params.organizationId, wrap.userEncryptionKeyId, wrap.wrappedKey, params.now),
        ),
      ];
      yield* d1WithUniqueCheck(
        async () => env.DB.batch(statements),
        "Vault already initialized for this organization",
      );
      return {
        organizationId: params.organizationId,
        vaultVersion: 1,
        createdAt: params.now,
        updatedAt: params.now,
      };
    }),

  findWrap: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${WRAP_COLUMNS} FROM "org_vault_key_wraps" WHERE "organization_id" = ? AND "vault_version" = ? AND "user_encryption_key_id" = ?`,
        )
          .bind(params.organizationId, params.vaultVersion, params.userEncryptionKeyId)
          .first<WrapRow>(),
      );
      return row === null ? null : toWrapModel(row);
    }),

  addWrap: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      // Insert only while the org is still at `vaultVersion` — the EXISTS guard
      // makes the version check and the insert one atomic statement (no TOCTOU).
      const result = yield* d1WithUniqueCheck(
        async () =>
          env.DB.prepare(
            `INSERT INTO "org_vault_key_wraps" (${WRAP_COLUMNS}) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM "org_vaults" WHERE "organization_id" = ? AND "vault_version" = ?)`,
          )
            .bind(
              params.organizationId,
              params.vaultVersion,
              params.userEncryptionKeyId,
              params.wrappedKey,
              params.now,
              params.organizationId,
              params.vaultVersion,
            )
            .run(),
        "Recipient already holds a vault key wrap at this version",
      );
      if (result.meta.changes === 0) {
        return yield* new Conflict({
          message: "Vault version changed since read; re-fetch and retry",
        });
      }
      return {
        organizationId: params.organizationId,
        vaultVersion: params.vaultVersion,
        userEncryptionKeyId: params.userEncryptionKeyId,
        wrappedKey: params.wrappedKey,
        createdAt: params.now,
      };
    }),

  listWraps: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${WRAP_COLUMNS} FROM "org_vault_key_wraps" WHERE "organization_id" = ? AND "vault_version" = ? ORDER BY "created_at" ASC`,
        )
          .bind(params.organizationId, params.vaultVersion)
          .all<WrapRow>(),
      );
      return rows.results.map(toWrapModel);
    }),

  listCredentialRefs: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      // D1 caps a compound SELECT at 5 terms, so the five credential tables fill
      // one UNION and env var value revisions are queried separately, then merged.
      // One numbered bind (`?1`) is reused across the union.
      const results = yield* Effect.promise(async () =>
        env.DB.batch<{ credential_type: EncryptedCredentialType; id: string }>([
          env.DB.prepare(
            `SELECT 'appleDistributionCertificate' AS credential_type, "id" FROM "apple_distribution_certificates" WHERE "organization_id" = ?1
             UNION ALL SELECT 'applePushKey', "id" FROM "apple_push_keys" WHERE "organization_id" = ?1
             UNION ALL SELECT 'ascApiKey', "id" FROM "asc_api_keys" WHERE "organization_id" = ?1
             UNION ALL SELECT 'googleServiceAccountKey', "id" FROM "google_service_account_keys" WHERE "organization_id" = ?1
             UNION ALL SELECT 'androidUploadKeystore', "id" FROM "android_upload_keystores" WHERE "organization_id" = ?1`,
          ).bind(params.organizationId),
          env.DB.prepare(
            `SELECT 'envVarValue' AS credential_type, "id" FROM "env_var_revisions" WHERE "organization_id" = ?`,
          ).bind(params.organizationId),
        ]),
      );
      return results
        .flatMap((result) => result.results)
        .map((row) => ({ credentialType: row.credential_type, id: row.id }));
    }),

  listCredentialDeks: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      // Same 5-term compound-SELECT cap as listCredentialRefs: credentials fill
      // one UNION, env var revisions are a second query, merged.
      const results = yield* Effect.promise(async () =>
        env.DB.batch<{
          credential_type: EncryptedCredentialType;
          id: string;
          wrapped_dek: string;
          vault_version: number;
        }>([
          env.DB.prepare(
            `SELECT 'appleDistributionCertificate' AS credential_type, "id", "wrapped_dek", "vault_version" FROM "apple_distribution_certificates" WHERE "organization_id" = ?1
             UNION ALL SELECT 'applePushKey', "id", "wrapped_dek", "vault_version" FROM "apple_push_keys" WHERE "organization_id" = ?1
             UNION ALL SELECT 'ascApiKey', "id", "wrapped_dek", "vault_version" FROM "asc_api_keys" WHERE "organization_id" = ?1
             UNION ALL SELECT 'googleServiceAccountKey', "id", "wrapped_dek", "vault_version" FROM "google_service_account_keys" WHERE "organization_id" = ?1
             UNION ALL SELECT 'androidUploadKeystore', "id", "wrapped_dek", "vault_version" FROM "android_upload_keystores" WHERE "organization_id" = ?1`,
          ).bind(params.organizationId),
          env.DB.prepare(
            `SELECT 'envVarValue' AS credential_type, "id", "wrapped_dek", "vault_version" FROM "env_var_revisions" WHERE "organization_id" = ?`,
          ).bind(params.organizationId),
        ]),
      );
      return results
        .flatMap((result) => result.results)
        .map((row) => ({
          credentialType: row.credential_type,
          credentialId: row.id,
          wrappedDek: row.wrapped_dek,
          vaultVersion: row.vault_version,
        }));
    }),

  rotate: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const newVersion = params.fromVersion + 1;

      // Statement order is load-bearing for compare-and-swap safety. Every write
      // is guarded on the OLD version and the version bump is LAST: if a
      // concurrent rotation already moved the vault past `fromVersion`, the
      // EXISTS guard on the inserts is false, the version-scoped deletes/updates
      // match nothing, and the final CAS changes 0 rows — so this batch commits
      // but mutates nothing, and we surface a Conflict to retry against the new
      // version. D1 runs the batch as one implicit transaction.
      const statements = [
        ...params.recipientWraps.map((wrap) =>
          env.DB.prepare(
            `INSERT INTO "org_vault_key_wraps" (${WRAP_COLUMNS}) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM "org_vaults" WHERE "organization_id" = ? AND "vault_version" = ?)`,
          ).bind(
            params.organizationId,
            newVersion,
            wrap.userEncryptionKeyId,
            wrap.wrappedKey,
            params.now,
            params.organizationId,
            params.fromVersion,
          ),
        ),
        env.DB.prepare(
          `DELETE FROM "org_vault_key_wraps" WHERE "organization_id" = ? AND "vault_version" = ?`,
        ).bind(params.organizationId, params.fromVersion),
        ...params.credentialDeks.map((dek) =>
          env.DB.prepare(
            `UPDATE "${CREDENTIAL_TABLES[dek.credentialType]}" SET "wrapped_dek" = ?, "vault_version" = ?, "updated_at" = ? WHERE "id" = ? AND "organization_id" = ? AND "vault_version" = ?`,
          ).bind(
            dek.wrappedDek,
            newVersion,
            params.now,
            dek.credentialId,
            params.organizationId,
            params.fromVersion,
          ),
        ),
        env.DB.prepare(
          `UPDATE "org_vaults" SET "vault_version" = ?, "updated_at" = ? WHERE "organization_id" = ? AND "vault_version" = ?`,
        ).bind(newVersion, params.now, params.organizationId, params.fromVersion),
      ];

      const results = yield* d1WithUniqueCheck(
        async () => env.DB.batch(statements),
        "Recipient appears twice in the rotation wraps",
      );

      // The version bump is the last statement; 0 rows changed means a concurrent
      // rotation moved the version out from under this one.
      const cas = results.at(-1);
      if ((cas?.meta.changes ?? 0) === 0) {
        return yield* new Conflict({
          message: "Vault version changed since read; re-fetch and retry",
        });
      }

      const vaultRow = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT "created_at" FROM "org_vaults" WHERE "organization_id" = ?`)
          .bind(params.organizationId)
          .first<{ created_at: string }>(),
      );
      return {
        organizationId: params.organizationId,
        vaultVersion: newVersion,
        createdAt: vaultRow?.created_at ?? params.now,
        updatedAt: params.now,
      };
    }),
});
