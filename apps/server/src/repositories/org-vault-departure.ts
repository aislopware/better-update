import { sql } from "kysely";

import type { Compilable, Kysely } from "kysely";

import type { DB } from "../db/schema";

/**
 * Discover which of a departing user's keys are vault recipients in this org: the
 * device keys holding a credentials-vault wrap, and (once the org has cut over to
 * a separate env vault) the device + account keys holding an env-vault wrap.
 * Extracted from `org-vault.ts` to keep that file under the line cap.
 */
export const discoverDepartureRecipients = async (
  db: Kysely<DB>,
  params: { readonly organizationId: string; readonly userId: string },
): Promise<{
  readonly cvKeyIds: string[];
  readonly evDeviceKeyIds: string[];
  readonly accountKeyIds: string[];
}> => {
  const cvRows = await db
    .selectFrom("user_encryption_keys as k")
    .innerJoin("org_vault_key_wraps as w", "w.user_encryption_key_id", "k.id")
    .select("k.id as id")
    .distinct()
    .where("k.user_id", "=", params.userId)
    .where("k.kind", "=", "device")
    .where("w.organization_id", "=", params.organizationId)
    .execute();
  const cvKeyIds = cvRows.map((row) => row.id);

  const vaultRow = await db
    .selectFrom("org_vaults")
    .select("env_vault_cutover_at")
    .where("organization_id", "=", params.organizationId)
    .executeTakeFirst();
  if (!vaultRow?.env_vault_cutover_at) {
    return { cvKeyIds, evDeviceKeyIds: [], accountKeyIds: [] };
  }

  const evDeviceRows = await db
    .selectFrom("user_encryption_keys as k")
    .innerJoin("org_env_vault_key_wraps as w", (join) =>
      join.onRef("w.recipient_id", "=", "k.id").on("w.recipient_kind", "=", "device"),
    )
    .select("k.id as id")
    .distinct()
    .where("k.user_id", "=", params.userId)
    .where("k.kind", "=", "device")
    .where("w.organization_id", "=", params.organizationId)
    .execute();

  const accountRows = await db
    .selectFrom("account_keys as a")
    .innerJoin("org_env_vault_key_wraps as w", (join) =>
      join.onRef("w.recipient_id", "=", "a.id").on("w.recipient_kind", "=", "account"),
    )
    .select("a.id as id")
    .distinct()
    .where("a.user_id", "=", params.userId)
    .where("w.organization_id", "=", params.organizationId)
    .execute();

  return {
    cvKeyIds,
    evDeviceKeyIds: evDeviceRows.map((row) => row.id),
    accountKeyIds: accountRows.map((row) => row.id),
  };
};

/**
 * Build the ordered D1 batch that binds a member's departure to the vault
 * recipient set — extracted from `org-vault.ts` to keep that file + method under
 * the line/statement caps. The repo discovers which of the user's keys are
 * recipients; this turns those id sets into the atomic write batch.
 *
 * Order matters: every drop is pushed BEFORE the global device-key revoke so the
 * revoke's `NOT EXISTS` sees the post-drop state (a key still wrapped anywhere,
 * in either vault, stays live).
 */
export const buildDepartureQueries = (
  db: Kysely<DB>,
  params: {
    readonly organizationId: string;
    readonly now: string;
    readonly reason: string;
    readonly cvKeyIds: readonly string[];
    readonly evDeviceKeyIds: readonly string[];
    readonly accountKeyIds: readonly string[];
    readonly allDeviceKeyIds: readonly string[];
  },
): Compilable[] => {
  const queries: Compilable[] = [];
  const touchesEv = params.evDeviceKeyIds.length > 0 || params.accountKeyIds.length > 0;

  // -- Credentials vault: drop wraps here + flag CV rotation. --
  if (params.cvKeyIds.length > 0) {
    queries.push(
      db
        .deleteFrom("org_vault_key_wraps")
        .where("organization_id", "=", params.organizationId)
        .where("user_encryption_key_id", "in", params.cvKeyIds),
      db
        .updateTable("org_vaults")
        .set({
          rotation_pending: 1,
          rotation_pending_since: sql`coalesce("rotation_pending_since", ${params.now})`,
          rotation_pending_reason: sql`coalesce("rotation_pending_reason", ${params.reason})`,
        })
        .where("organization_id", "=", params.organizationId),
    );
  }

  // -- Env vault: drop the user's device + account wraps here + flag EV. --
  if (params.evDeviceKeyIds.length > 0) {
    queries.push(
      db
        .deleteFrom("org_env_vault_key_wraps")
        .where("organization_id", "=", params.organizationId)
        .where("recipient_kind", "=", "device")
        .where("recipient_id", "in", params.evDeviceKeyIds),
    );
  }
  if (params.accountKeyIds.length > 0) {
    queries.push(
      db
        .deleteFrom("org_env_vault_key_wraps")
        .where("organization_id", "=", params.organizationId)
        .where("recipient_kind", "=", "account")
        .where("recipient_id", "in", params.accountKeyIds),
    );
  }
  if (touchesEv) {
    queries.push(
      db
        .updateTable("org_vaults")
        .set({
          env_rotation_pending: 1,
          env_rotation_pending_since: sql`coalesce("env_rotation_pending_since", ${params.now})`,
          env_rotation_pending_reason: sql`coalesce("env_rotation_pending_reason", ${params.reason})`,
        })
        .where("organization_id", "=", params.organizationId),
    );
  }

  // Globally revoke a device key only if, after the drops above, it holds no wrap
  // in ANY org in EITHER vault.
  if (params.allDeviceKeyIds.length > 0) {
    queries.push(
      db
        .updateTable("user_encryption_keys")
        .set({ revoked_at: params.now })
        .where("id", "in", params.allDeviceKeyIds)
        .where("revoked_at", "is", null)
        .where((eb) =>
          eb.and([
            eb.not(
              eb.exists(
                eb
                  .selectFrom("org_vault_key_wraps as w2")
                  .select(sql`1`.as("one"))
                  .whereRef("w2.user_encryption_key_id", "=", "user_encryption_keys.id"),
              ),
            ),
            eb.not(
              eb.exists(
                eb
                  .selectFrom("org_env_vault_key_wraps as w3")
                  .select(sql`1`.as("one"))
                  .where("w3.recipient_kind", "=", "device")
                  .whereRef("w3.recipient_id", "=", "user_encryption_keys.id"),
              ),
            ),
          ]),
        ),
    );
  }

  return queries;
};
