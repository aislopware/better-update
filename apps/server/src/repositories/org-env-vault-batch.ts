import { sql } from "kysely";

import type { Compilable, Kysely } from "kysely";

import type { DB } from "../db/schema";
import type { EnvVaultRecipientKind } from "../vault-models";

// Batch builders for the ENV vault's two atomic, CAS-guarded writes — the cutover
// (fork env values into their own key) and the rotation. Extracted from
// `org-env-vault.ts` to keep that file + its methods under the line/statement caps.
// Mirrors the credentials-vault `rotate` pattern: every write guards on the same
// state the final org-row update CAS-checks, so a lost race mutates nothing.

export interface EnvWrapInput {
  readonly recipientKind: EnvVaultRecipientKind;
  readonly recipientId: string;
  readonly wrappedKey: string;
}

export interface EnvDekUpdate {
  readonly credentialId: string;
  readonly wrappedDek: string;
}

const WRAP_COLUMNS = [
  "organization_id",
  "env_vault_version",
  "recipient_kind",
  "recipient_id",
  "wrapped_key",
  "created_at",
] as const;

/**
 * INSERT one env wrap at `insertVersion`, but only if the org row still passes the
 * cutover guard (`env_vault_version = guardVersion` for a rotation, or
 * `env_vault_cutover_at IS NULL` for the cutover). The WHERE and INSERT are one
 * atomic statement (INSERT … SELECT … FROM org_vaults WHERE …).
 */
export const insertEnvWrapGuarded = (
  db: Kysely<DB>,
  params: {
    readonly organizationId: string;
    readonly insertVersion: number;
    readonly wrap: EnvWrapInput;
    readonly now: string;
    readonly guard:
      | { readonly kind: "version"; readonly version: number }
      | { readonly kind: "cutover" };
  },
) =>
  db
    .insertInto("org_env_vault_key_wraps")
    .columns(WRAP_COLUMNS)
    .expression((eb) => {
      const base = eb
        .selectFrom("org_vaults")
        .select([
          eb.val(params.organizationId).as("organization_id"),
          eb.val(params.insertVersion).as("env_vault_version"),
          eb.val(params.wrap.recipientKind).as("recipient_kind"),
          eb.val(params.wrap.recipientId).as("recipient_id"),
          eb.val(params.wrap.wrappedKey).as("wrapped_key"),
          eb.val(params.now).as("created_at"),
        ])
        .where("organization_id", "=", params.organizationId);
      return params.guard.kind === "version"
        ? base.where("env_vault_version", "=", params.guard.version)
        : base.where("env_vault_cutover_at", "is", null);
    });

/**
 * The one-shot cutover: wrap the new env key to every recipient, re-key every env
 * DEK from the credentials key to the env key in place, and stamp
 * `env_vault_cutover_at` + `env_vault_version = 1`. Guarded on
 * `env_vault_cutover_at IS NULL` so a second cutover mutates nothing. The org-row
 * update is LAST so its `changes` is the CAS signal.
 */
export const buildCutoverQueries = (
  db: Kysely<DB>,
  params: {
    readonly organizationId: string;
    readonly wraps: readonly EnvWrapInput[];
    readonly envDeks: readonly EnvDekUpdate[];
    readonly now: string;
  },
): Compilable[] => [
  ...params.wraps.map((wrap) =>
    insertEnvWrapGuarded(db, {
      organizationId: params.organizationId,
      insertVersion: 1,
      wrap,
      now: params.now,
      guard: { kind: "cutover" },
    }),
  ),
  ...params.envDeks.map((dek) =>
    db
      .updateTable("env_var_revisions")
      .set({ wrapped_dek: dek.wrappedDek, vault_version: 1, updated_at: params.now })
      .where("id", "=", dek.credentialId)
      .where("organization_id", "=", params.organizationId)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom("org_vaults")
            .select(sql`1`.as("one"))
            .where("organization_id", "=", params.organizationId)
            .where("env_vault_cutover_at", "is", null),
        ),
      ),
  ),
  db
    .updateTable("org_vaults")
    .set({ env_vault_cutover_at: params.now, env_vault_version: 1, updated_at: params.now })
    .where("organization_id", "=", params.organizationId)
    .where("env_vault_cutover_at", "is", null),
];

/**
 * Rotate the env vault key: re-wrap to the surviving recipients at the new
 * version, drop the old wraps, re-key every env DEK, bump `env_vault_version`, and
 * clear `env_rotation_pending`. CAS-guarded on `env_vault_version = fromVersion`.
 */
export const buildEnvRotateQueries = (
  db: Kysely<DB>,
  params: {
    readonly organizationId: string;
    readonly fromVersion: number;
    readonly wraps: readonly EnvWrapInput[];
    readonly envDeks: readonly EnvDekUpdate[];
    readonly now: string;
  },
): Compilable[] => {
  const newVersion = params.fromVersion + 1;
  return [
    ...params.wraps.map((wrap) =>
      insertEnvWrapGuarded(db, {
        organizationId: params.organizationId,
        insertVersion: newVersion,
        wrap,
        now: params.now,
        guard: { kind: "version", version: params.fromVersion },
      }),
    ),
    db
      .deleteFrom("org_env_vault_key_wraps")
      .where("organization_id", "=", params.organizationId)
      .where("env_vault_version", "=", params.fromVersion),
    ...params.envDeks.map((dek) =>
      db
        .updateTable("env_var_revisions")
        .set({ wrapped_dek: dek.wrappedDek, vault_version: newVersion, updated_at: params.now })
        .where("id", "=", dek.credentialId)
        .where("organization_id", "=", params.organizationId)
        .where("vault_version", "=", params.fromVersion),
    ),
    db
      .updateTable("org_vaults")
      .set({
        env_vault_version: newVersion,
        updated_at: params.now,
        env_rotation_pending: 0,
        env_rotation_pending_since: null,
        env_rotation_pending_reason: null,
      })
      .where("organization_id", "=", params.organizationId)
      .where("env_vault_version", "=", params.fromVersion),
  ];
};
