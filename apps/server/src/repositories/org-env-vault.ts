import { Context, Effect, Layer } from "effect";

import type { Selectable } from "kysely";

import { d1Session } from "../cloudflare/context";
import { kyselyDb } from "../cloudflare/db";
import { Conflict } from "../errors";
import { bindForBatch, d1WithUniqueCheck } from "./d1-helpers";
import {
  buildCutoverQueries,
  buildEnvRotateQueries,
  insertEnvWrapGuarded,
} from "./org-env-vault-batch";
import { envCredentialDekQuery, envCredentialRefQuery } from "./org-vault-credential-queries";
import { toVaultModel, VAULT_COLUMNS } from "./org-vault-row";

import type { OrgEnvVaultKeyWraps } from "../db/schema";
import type {
  CredentialDekRefModel,
  CredentialRef,
  EnvVaultRecipientKind,
  OrgEnvVaultKeyWrapModel,
  OrgVaultModel,
} from "../vault-models";
import type { EnvDekUpdate, EnvWrapInput } from "./org-env-vault-batch";

// -- Port -------------------------------------------------------------------

export interface OrgEnvVaultRepository {
  /** A single env recipient's wrap at a version, or `null` if not granted. */
  readonly findEnvWrap: (params: {
    readonly organizationId: string;
    readonly envVaultVersion: number;
    readonly recipientKind: EnvVaultRecipientKind;
    readonly recipientId: string;
  }) => Effect.Effect<OrgEnvVaultKeyWrapModel | null>;

  /** All env recipients holding the env key at a version (Access view + grant validation). */
  readonly listEnvWraps: (params: {
    readonly organizationId: string;
    readonly envVaultVersion: number;
  }) => Effect.Effect<readonly OrgEnvVaultKeyWrapModel[]>;

  /**
   * Grant: add one env wrap at the current env version (CAS on `env_vault_version`).
   * A version mismatch or a duplicate recipient fails `Conflict`.
   */
  readonly addEnvWrap: (params: {
    readonly organizationId: string;
    readonly envVaultVersion: number;
    readonly recipientKind: EnvVaultRecipientKind;
    readonly recipientId: string;
    readonly wrappedKey: string;
    readonly now: string;
  }) => Effect.Effect<OrgEnvVaultKeyWrapModel, Conflict>;

  /** Env-vault rotation coverage refs (env-var revisions only). */
  readonly listEnvCredentialRefs: (params: {
    readonly organizationId: string;
  }) => Effect.Effect<readonly CredentialRef[]>;

  /** Every env-var revision's currently-wrapped DEK (+ version) — the rotation source set. */
  readonly listEnvCredentialDeks: (params: {
    readonly organizationId: string;
  }) => Effect.Effect<readonly CredentialDekRefModel[]>;

  /**
   * The one-shot cutover: fork the org's env values into a separate env vault.
   * Atomic + idempotent — CAS-guarded on `env_vault_cutover_at IS NULL`, so a
   * second attempt mutates nothing and fails `Conflict`.
   */
  readonly cutover: (params: {
    readonly organizationId: string;
    readonly wraps: readonly EnvWrapInput[];
    readonly envDeks: readonly EnvDekUpdate[];
    readonly now: string;
  }) => Effect.Effect<OrgVaultModel, Conflict>;

  /** Rotate the env vault key (CAS on `env_vault_version`); clears `env_rotation_pending`. */
  readonly rotateEnv: (params: {
    readonly organizationId: string;
    readonly fromVersion: number;
    readonly wraps: readonly EnvWrapInput[];
    readonly envDeks: readonly EnvDekUpdate[];
    readonly now: string;
  }) => Effect.Effect<OrgVaultModel, Conflict>;
}

export class OrgEnvVaultRepo extends Context.Tag("api/OrgEnvVaultRepo")<
  OrgEnvVaultRepo,
  OrgEnvVaultRepository
>() {}

// -- D1 Adapter -------------------------------------------------------------

const ENV_WRAP_COLUMNS = [
  "organization_id",
  "env_vault_version",
  "recipient_kind",
  "recipient_id",
  "wrapped_key",
  "created_at",
] as const;

const toEnvWrapModel = (row: Selectable<OrgEnvVaultKeyWraps>): OrgEnvVaultKeyWrapModel => ({
  organizationId: row.organization_id,
  envVaultVersion: row.env_vault_version,
  recipientKind: row.recipient_kind,
  recipientId: row.recipient_id,
  wrappedKey: row.wrapped_key,
  createdAt: row.created_at,
});

/** Re-read the org_vaults row after an atomic write; `Conflict` if the CAS guard fired. */
const readVaultAfterCas = (
  organizationId: string,
  lastChanges: number,
): Effect.Effect<OrgVaultModel, Conflict> =>
  Effect.gen(function* () {
    if (lastChanges === 0) {
      return yield* new Conflict({
        message: "Env vault state changed since read; re-fetch and retry",
      });
    }
    const db = yield* kyselyDb;
    const row = yield* Effect.promise(async () =>
      db
        .selectFrom("org_vaults")
        .select(VAULT_COLUMNS)
        .where("organization_id", "=", organizationId)
        .executeTakeFirst(),
    );
    if (row === undefined) {
      return yield* new Conflict({ message: "Vault not initialized" });
    }
    return toVaultModel(row, organizationId);
  });

export const OrgEnvVaultRepoLive = Layer.succeed(OrgEnvVaultRepo, {
  findEnvWrap: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("org_env_vault_key_wraps")
          .select(ENV_WRAP_COLUMNS)
          .where("organization_id", "=", params.organizationId)
          .where("env_vault_version", "=", params.envVaultVersion)
          .where("recipient_kind", "=", params.recipientKind)
          .where("recipient_id", "=", params.recipientId)
          .executeTakeFirst(),
      );
      return row === undefined ? null : toEnvWrapModel(row);
    }),

  listEnvWraps: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("org_env_vault_key_wraps")
          .select(ENV_WRAP_COLUMNS)
          .where("organization_id", "=", params.organizationId)
          .where("env_vault_version", "=", params.envVaultVersion)
          .orderBy("created_at", "asc")
          .execute(),
      );
      return rows.map(toEnvWrapModel);
    }),

  addEnvWrap: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const session = yield* d1Session;
      const insertQuery = insertEnvWrapGuarded(db, {
        organizationId: params.organizationId,
        insertVersion: params.envVaultVersion,
        wrap: {
          recipientKind: params.recipientKind,
          recipientId: params.recipientId,
          wrappedKey: params.wrappedKey,
        },
        now: params.now,
        guard: { kind: "version", version: params.envVaultVersion },
      });
      const result = yield* d1WithUniqueCheck(async () => {
        const compiled = insertQuery.compile();
        return session
          .prepare(compiled.sql)
          .bind(...compiled.parameters)
          .run();
      }, "Recipient already holds an env-vault key wrap at this version");
      if (result.meta.changes === 0) {
        return yield* new Conflict({
          message: "Env vault version changed since read; re-fetch and retry",
        });
      }
      return {
        organizationId: params.organizationId,
        envVaultVersion: params.envVaultVersion,
        recipientKind: params.recipientKind,
        recipientId: params.recipientId,
        wrappedKey: params.wrappedKey,
        createdAt: params.now,
      };
    }),

  listEnvCredentialRefs: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        envCredentialRefQuery(db, params.organizationId).execute(),
      );
      return rows.map((row) => ({ credentialType: row.credential_type, id: row.id }));
    }),

  listEnvCredentialDeks: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        envCredentialDekQuery(db, params.organizationId).execute(),
      );
      return rows.map((row) => ({
        credentialType: row.credential_type,
        credentialId: row.id,
        wrappedDek: row.wrapped_dek,
        vaultVersion: row.vault_version,
      }));
    }),

  cutover: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const session = yield* d1Session;
      const queries = buildCutoverQueries(db, {
        organizationId: params.organizationId,
        wraps: params.wraps,
        envDeks: params.envDeks,
        now: params.now,
      });
      const results = yield* d1WithUniqueCheck(
        async () => session.batch(bindForBatch(session, queries)),
        "Recipient appears twice in the cutover wraps",
      );
      return yield* readVaultAfterCas(params.organizationId, results.at(-1)?.meta.changes ?? 0);
    }),

  rotateEnv: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const session = yield* d1Session;
      const queries = buildEnvRotateQueries(db, {
        organizationId: params.organizationId,
        fromVersion: params.fromVersion,
        wraps: params.wraps,
        envDeks: params.envDeks,
        now: params.now,
      });
      const results = yield* d1WithUniqueCheck(
        async () => session.batch(bindForBatch(session, queries)),
        "Recipient appears twice in the env rotation wraps",
      );
      return yield* readVaultAfterCas(params.organizationId, results.at(-1)?.meta.changes ?? 0);
    }),
});
