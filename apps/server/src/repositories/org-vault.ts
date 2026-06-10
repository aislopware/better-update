import { Context, Effect, Layer } from "effect";
import { sql } from "kysely";

import type { Compilable, Kysely, Selectable } from "kysely";

import { d1Session } from "../cloudflare/context";
import { d1Batch, kyselyDb } from "../cloudflare/db";
import { Conflict } from "../errors";
import { d1WithUniqueCheck } from "./d1-helpers";
import { credentialDekQueries, credentialRefQueries } from "./org-vault-credential-queries";

import type { DB, OrgVaultKeyWraps, OrgVaults } from "../db/schema";
import type {
  CredentialDekRefModel,
  CredentialRef,
  EncryptedCredentialType,
  OrgVaultKeyWrapModel,
  OrgVaultModel,
} from "../vault-models";

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

  /**
   * Bind a member's departure to the vault: drop every wrap in THIS org for the
   * device keys owned by `userId` (the org-scoped revoke), flip the vault to
   * `rotation_pending`, and globally revoke a device key only if it no longer
   * holds a wrap in ANY org — device keys are user-global (shared across orgs),
   * so one still wrapped elsewhere stays live. Returns the dropped key ids for
   * audit; a no-op returning `[]` if the user has no wrap here (or no vault).
   */
  readonly dropDeviceWrapsForUser: (params: {
    readonly organizationId: string;
    readonly userId: string;
    readonly reason: string;
    readonly now: string;
  }) => Effect.Effect<readonly string[]>;
}

export class OrgVaultRepo extends Context.Tag("api/OrgVaultRepo")<
  OrgVaultRepo,
  OrgVaultRepository
>() {}

// -- D1 Adapter -------------------------------------------------------------

const VAULT_COLUMNS = [
  "organization_id",
  "vault_version",
  "created_at",
  "updated_at",
  "rotation_pending",
  "rotation_pending_since",
  "rotation_pending_reason",
] as const;

const WRAP_COLUMNS = [
  "organization_id",
  "vault_version",
  "user_encryption_key_id",
  "wrapped_key",
  "created_at",
] as const;

/** Typed allowlist of credential table names for rotation, keyed by `CredentialType`. */
const CREDENTIAL_TABLES = {
  appleDistributionCertificate: "apple_distribution_certificates",
  applePushKey: "apple_push_keys",
  ascApiKey: "asc_api_keys",
  googleServiceAccountKey: "google_service_account_keys",
  androidUploadKeystore: "android_upload_keystores",
  envVarValue: "env_var_revisions",
} as const satisfies Record<EncryptedCredentialType, keyof DB>;

const toVaultModel = (row: Selectable<OrgVaults>, organizationId: string): OrgVaultModel => ({
  organizationId,
  vaultVersion: row.vault_version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  rotationPending: row.rotation_pending !== 0,
  rotationPendingSince: row.rotation_pending_since,
  rotationPendingReason: row.rotation_pending_reason,
});

const toWrapModel = (row: Selectable<OrgVaultKeyWraps>): OrgVaultKeyWrapModel => ({
  organizationId: row.organization_id,
  vaultVersion: row.vault_version,
  userEncryptionKeyId: row.user_encryption_key_id,
  wrappedKey: row.wrapped_key,
  createdAt: row.created_at,
});

/** Version-guarded atomic INSERT … SELECT … WHERE vault_version = guardVersion. */
const insertWrapGuarded = (
  db: Kysely<DB>,
  params: {
    readonly organizationId: string;
    readonly insertVersion: number;
    readonly guardVersion: number;
    readonly userEncryptionKeyId: string;
    readonly wrappedKey: string;
    readonly now: string;
  },
) =>
  db
    .insertInto("org_vault_key_wraps")
    .columns([
      "organization_id",
      "vault_version",
      "user_encryption_key_id",
      "wrapped_key",
      "created_at",
    ])
    .expression((eb) =>
      eb
        .selectFrom("org_vaults")
        .select([
          eb.val(params.organizationId).as("organization_id"),
          eb.val(params.insertVersion).as("vault_version"),
          eb.val(params.userEncryptionKeyId).as("user_encryption_key_id"),
          eb.val(params.wrappedKey).as("wrapped_key"),
          eb.val(params.now).as("created_at"),
        ])
        .where("organization_id", "=", params.organizationId)
        .where("vault_version", "=", params.guardVersion),
    );

/** Compile Kysely queries into bound D1 statements for `session.batch`. */
const bindForBatch = (session: D1DatabaseSession, queries: readonly Compilable[]) =>
  queries.map((query) => {
    const compiled = query.compile();
    return session.prepare(compiled.sql).bind(...compiled.parameters);
  });

export const OrgVaultRepoLive = Layer.succeed(OrgVaultRepo, {
  getVault: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("org_vaults")
          .select(VAULT_COLUMNS)
          .where("organization_id", "=", params.organizationId)
          .executeTakeFirst(),
      );
      return row === undefined ? null : toVaultModel(row, params.organizationId);
    }),

  bootstrap: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const session = yield* d1Session;
      const queries: Compilable[] = [
        db.insertInto("org_vaults").values({
          organization_id: params.organizationId,
          vault_version: 1,
          created_at: params.now,
          updated_at: params.now,
        }),
        ...params.wraps.map((wrap) =>
          db.insertInto("org_vault_key_wraps").values({
            organization_id: params.organizationId,
            vault_version: 1,
            user_encryption_key_id: wrap.userEncryptionKeyId,
            wrapped_key: wrap.wrappedKey,
            created_at: params.now,
          }),
        ),
      ];
      yield* d1WithUniqueCheck(
        async () => session.batch(bindForBatch(session, queries)),
        "Vault already initialized for this organization",
      );
      return {
        organizationId: params.organizationId,
        vaultVersion: 1,
        createdAt: params.now,
        updatedAt: params.now,
        rotationPending: false,
        rotationPendingSince: null,
        rotationPendingReason: null,
      };
    }),

  findWrap: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("org_vault_key_wraps")
          .select(WRAP_COLUMNS)
          .where("organization_id", "=", params.organizationId)
          .where("vault_version", "=", params.vaultVersion)
          .where("user_encryption_key_id", "=", params.userEncryptionKeyId)
          .executeTakeFirst(),
      );
      return row === undefined ? null : toWrapModel(row);
    }),

  addWrap: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const session = yield* d1Session;
      const insertQuery = insertWrapGuarded(db, {
        organizationId: params.organizationId,
        insertVersion: params.vaultVersion,
        guardVersion: params.vaultVersion,
        userEncryptionKeyId: params.userEncryptionKeyId,
        wrappedKey: params.wrappedKey,
        now: params.now,
      });
      // Version-guarded: the WHERE clause and INSERT are one atomic statement.
      const result = yield* d1WithUniqueCheck(async () => {
        const compiled = insertQuery.compile();
        return session
          .prepare(compiled.sql)
          .bind(...compiled.parameters)
          .run();
      }, "Recipient already holds a vault key wrap at this version");
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
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("org_vault_key_wraps")
          .select(WRAP_COLUMNS)
          .where("organization_id", "=", params.organizationId)
          .where("vault_version", "=", params.vaultVersion)
          .orderBy("created_at", "asc")
          .execute(),
      );
      return rows.map(toWrapModel);
    }),

  listCredentialRefs: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const [credentialRows, envVarRows] = yield* d1Batch(
        credentialRefQueries(db, params.organizationId),
      );
      return [...credentialRows, ...envVarRows].map((row) => ({
        credentialType: row.credential_type,
        id: row.id,
      }));
    }),

  listCredentialDeks: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const [credentialRows, envVarRows] = yield* d1Batch(
        credentialDekQueries(db, params.organizationId),
      );
      return [...credentialRows, ...envVarRows].map((row) => ({
        credentialType: row.credential_type,
        credentialId: row.id,
        wrappedDek: row.wrapped_dek,
        vaultVersion: row.vault_version,
      }));
    }),

  rotate: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const session = yield* d1Session;
      const newVersion = params.fromVersion + 1;

      // CAS batch: all writes guard on `fromVersion`, version bump is last.
      // Concurrent rotation → version-guarded statements match nothing → 0 changes
      // on the final bump → Conflict. D1 runs the batch as one implicit transaction.
      const queries: Compilable[] = [
        ...params.recipientWraps.map((wrap) =>
          insertWrapGuarded(db, {
            organizationId: params.organizationId,
            insertVersion: newVersion,
            guardVersion: params.fromVersion,
            userEncryptionKeyId: wrap.userEncryptionKeyId,
            wrappedKey: wrap.wrappedKey,
            now: params.now,
          }),
        ),
        db
          .deleteFrom("org_vault_key_wraps")
          .where("organization_id", "=", params.organizationId)
          .where("vault_version", "=", params.fromVersion),
        ...params.credentialDeks.map((dek) =>
          db
            .updateTable(CREDENTIAL_TABLES[dek.credentialType])
            .set({
              wrapped_dek: dek.wrappedDek,
              vault_version: newVersion,
              updated_at: params.now,
            })
            .where("id", "=", dek.credentialId)
            .where("organization_id", "=", params.organizationId)
            .where("vault_version", "=", params.fromVersion),
        ),
        db
          .updateTable("org_vaults")
          // A rotation re-keys the vault, so it also clears any pending-rotation
          // flag set by a member removal/downgrade — this is the resolution.
          .set({
            vault_version: newVersion,
            updated_at: params.now,
            rotation_pending: 0,
            rotation_pending_since: null,
            rotation_pending_reason: null,
          })
          .where("organization_id", "=", params.organizationId)
          .where("vault_version", "=", params.fromVersion),
      ];

      const results = yield* d1WithUniqueCheck(
        async () => session.batch(bindForBatch(session, queries)),
        "Recipient appears twice in the rotation wraps",
      );

      // 0 changes on the version bump = concurrent rotation; CAS guard fired.
      const cas = results.at(-1);
      if ((cas?.meta.changes ?? 0) === 0) {
        return yield* new Conflict({
          message: "Vault version changed since read; re-fetch and retry",
        });
      }

      const vaultRow = yield* Effect.promise(async () =>
        db
          .selectFrom("org_vaults")
          .select("created_at")
          .where("organization_id", "=", params.organizationId)
          .executeTakeFirst(),
      );
      return {
        organizationId: params.organizationId,
        vaultVersion: newVersion,
        createdAt: vaultRow?.created_at ?? params.now,
        updatedAt: params.now,
        rotationPending: false,
        rotationPendingSince: null,
        rotationPendingReason: null,
      };
    }),

  dropDeviceWrapsForUser: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const session = yield* d1Session;
      // Device keys owned by this user that are recipients in THIS org.
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("user_encryption_keys as k")
          .innerJoin("org_vault_key_wraps as w", "w.user_encryption_key_id", "k.id")
          .select("k.id as id")
          .distinct()
          .where("k.user_id", "=", params.userId)
          .where("k.kind", "=", "device")
          .where("w.organization_id", "=", params.organizationId)
          .execute(),
      );
      const keyIds = rows.map((row) => row.id);
      if (keyIds.length === 0) {
        return [];
      }
      const queries: Compilable[] = [
        // 1. Drop their wraps in THIS org — the org-scoped revoke.
        db
          .deleteFrom("org_vault_key_wraps")
          .where("organization_id", "=", params.organizationId)
          .where("user_encryption_key_id", "in", keyIds),
        // 2. Mark the vault rotation-pending, keeping the earliest reason/since.
        db
          .updateTable("org_vaults")
          .set({
            rotation_pending: 1,
            rotation_pending_since: sql`coalesce("rotation_pending_since", ${params.now})`,
            rotation_pending_reason: sql`coalesce("rotation_pending_reason", ${params.reason})`,
          })
          .where("organization_id", "=", params.organizationId),
        // 3. Globally revoke a device key ONLY if it now holds no wrap in ANY org.
        //    Runs after the delete in the same transaction, so the NOT EXISTS sees
        //    the post-drop state; a key still wrapped elsewhere stays live.
        db
          .updateTable("user_encryption_keys")
          .set({ revoked_at: params.now })
          .where("id", "in", keyIds)
          .where("revoked_at", "is", null)
          .where((eb) =>
            eb.not(
              eb.exists(
                eb
                  .selectFrom("org_vault_key_wraps as w2")
                  .select(sql`1`.as("one"))
                  .whereRef("w2.user_encryption_key_id", "=", "user_encryption_keys.id"),
              ),
            ),
          ),
      ];
      yield* Effect.promise(async () => session.batch(bindForBatch(session, queries)));
      return keyIds;
    }),
});
