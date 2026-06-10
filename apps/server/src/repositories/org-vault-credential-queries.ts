import { sql } from "kysely";

import type { Kysely } from "kysely";

import type { DB } from "../db/schema";
import type { EncryptedCredentialType } from "../vault-models";

// The org's E2E-encrypted rows live across five signing-credential tables plus
// env-var revisions. D1 caps a compound SELECT at five UNION terms, so each set
// is two queries (the five credentials in one UNION ALL, env vars separately)
// run via `d1Batch`. These builders are extracted from `org-vault.ts` to keep
// that file under the line cap.

/** Rotation coverage refs (type + id) for every encrypted row in the org. */
export const credentialRefQueries = (db: Kysely<DB>, organizationId: string) => {
  const credentialRefs = db
    .selectFrom("apple_distribution_certificates")
    .select([
      sql<EncryptedCredentialType>`'appleDistributionCertificate'`.as("credential_type"),
      "id",
    ])
    .where("organization_id", "=", organizationId)
    .unionAll(
      db
        .selectFrom("apple_push_keys")
        .select([sql<EncryptedCredentialType>`'applePushKey'`.as("credential_type"), "id"])
        .where("organization_id", "=", organizationId),
    )
    .unionAll(
      db
        .selectFrom("asc_api_keys")
        .select([sql<EncryptedCredentialType>`'ascApiKey'`.as("credential_type"), "id"])
        .where("organization_id", "=", organizationId),
    )
    .unionAll(
      db
        .selectFrom("google_service_account_keys")
        .select([
          sql<EncryptedCredentialType>`'googleServiceAccountKey'`.as("credential_type"),
          "id",
        ])
        .where("organization_id", "=", organizationId),
    )
    .unionAll(
      db
        .selectFrom("android_upload_keystores")
        .select([sql<EncryptedCredentialType>`'androidUploadKeystore'`.as("credential_type"), "id"])
        .where("organization_id", "=", organizationId),
    );
  const envVarRefs = db
    .selectFrom("env_var_revisions")
    .select([sql<EncryptedCredentialType>`'envVarValue'`.as("credential_type"), "id"])
    .where("organization_id", "=", organizationId);
  return [credentialRefs, envVarRefs] as const;
};

/** The currently-wrapped DEK (+ version) for every encrypted row — the rotation source set. */
export const credentialDekQueries = (db: Kysely<DB>, organizationId: string) => {
  const credentialDeks = db
    .selectFrom("apple_distribution_certificates")
    .select([
      sql<EncryptedCredentialType>`'appleDistributionCertificate'`.as("credential_type"),
      "id",
      "wrapped_dek",
      "vault_version",
    ])
    .where("organization_id", "=", organizationId)
    .unionAll(
      db
        .selectFrom("apple_push_keys")
        .select([
          sql<EncryptedCredentialType>`'applePushKey'`.as("credential_type"),
          "id",
          "wrapped_dek",
          "vault_version",
        ])
        .where("organization_id", "=", organizationId),
    )
    .unionAll(
      db
        .selectFrom("asc_api_keys")
        .select([
          sql<EncryptedCredentialType>`'ascApiKey'`.as("credential_type"),
          "id",
          "wrapped_dek",
          "vault_version",
        ])
        .where("organization_id", "=", organizationId),
    )
    .unionAll(
      db
        .selectFrom("google_service_account_keys")
        .select([
          sql<EncryptedCredentialType>`'googleServiceAccountKey'`.as("credential_type"),
          "id",
          "wrapped_dek",
          "vault_version",
        ])
        .where("organization_id", "=", organizationId),
    )
    .unionAll(
      db
        .selectFrom("android_upload_keystores")
        .select([
          sql<EncryptedCredentialType>`'androidUploadKeystore'`.as("credential_type"),
          "id",
          "wrapped_dek",
          "vault_version",
        ])
        .where("organization_id", "=", organizationId),
    );
  const envVarDeks = db
    .selectFrom("env_var_revisions")
    .select([
      sql<EncryptedCredentialType>`'envVarValue'`.as("credential_type"),
      "id",
      "wrapped_dek",
      "vault_version",
    ])
    .where("organization_id", "=", organizationId);
  return [credentialDeks, envVarDeks] as const;
};
