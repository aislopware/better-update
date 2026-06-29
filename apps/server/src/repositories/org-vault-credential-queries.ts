import { sql } from "kysely";

import type { Kysely } from "kysely";

import type { DB } from "../db/schema";
import type { EncryptedCredentialType } from "../vault-models";

// The org's E2E-encrypted rows live across several signing-credential tables
// plus env-var revisions. D1 caps a compound SELECT at five UNION terms, so each
// set is split into two queries run via `d1Batch`: the first five
// signing-credential tables in one UNION ALL, and an "aux" UNION ALL holding the
// later-added cert tables together with env-var revisions (kept <= five terms).
// These builders are extracted from `org-vault.ts` to keep that file under the
// line cap.
//
// `includeEnv` controls whether env-var revisions are part of the CREDENTIALS
// vault's coverage. Before an org cuts over to a separate env vault (spec 11),
// env DEKs are wrapped under the credentials-vault key and rotate with it
// (`includeEnv = true`). After the cutover they belong to the env vault and are
// rotated via the env-vault builders below (`includeEnv = false`).

/** Rotation coverage refs (type + id) for the credentials vault. */
export const credentialRefQueries = (
  db: Kysely<DB>,
  organizationId: string,
  includeEnv: boolean,
) => {
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
  const auxRefs = db
    .selectFrom("apple_push_certificates")
    .select([sql<EncryptedCredentialType>`'applePushCertificate'`.as("credential_type"), "id"])
    .where("organization_id", "=", organizationId)
    .unionAll(
      db
        .selectFrom("apple_pay_certificates")
        .select([sql<EncryptedCredentialType>`'applePayCertificate'`.as("credential_type"), "id"])
        .where("organization_id", "=", organizationId),
    )
    .unionAll(
      db
        .selectFrom("apple_pass_type_certificates")
        .select([
          sql<EncryptedCredentialType>`'applePassTypeCertificate'`.as("credential_type"),
          "id",
        ])
        .where("organization_id", "=", organizationId),
    );
  const auxRefsWithEnv = auxRefs.unionAll(
    db
      .selectFrom("env_var_revisions")
      .select([sql<EncryptedCredentialType>`'envVarValue'`.as("credential_type"), "id"])
      .where("organization_id", "=", organizationId),
  );
  return [credentialRefs, includeEnv ? auxRefsWithEnv : auxRefs] as const;
};

/** The currently-wrapped DEK (+ version) for every credentials-vault row — the rotation source set. */
export const credentialDekQueries = (
  db: Kysely<DB>,
  organizationId: string,
  includeEnv: boolean,
) => {
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
  const auxDeks = db
    .selectFrom("apple_push_certificates")
    .select([
      sql<EncryptedCredentialType>`'applePushCertificate'`.as("credential_type"),
      "id",
      "wrapped_dek",
      "vault_version",
    ])
    .where("organization_id", "=", organizationId)
    .unionAll(
      db
        .selectFrom("apple_pay_certificates")
        .select([
          sql<EncryptedCredentialType>`'applePayCertificate'`.as("credential_type"),
          "id",
          "wrapped_dek",
          "vault_version",
        ])
        .where("organization_id", "=", organizationId),
    )
    .unionAll(
      db
        .selectFrom("apple_pass_type_certificates")
        .select([
          sql<EncryptedCredentialType>`'applePassTypeCertificate'`.as("credential_type"),
          "id",
          "wrapped_dek",
          "vault_version",
        ])
        .where("organization_id", "=", organizationId),
    );
  const auxDeksWithEnv = auxDeks.unionAll(envCredentialDekQuery(db, organizationId));
  return [credentialDeks, includeEnv ? auxDeksWithEnv : auxDeks] as const;
};

/** Rotation coverage refs for the ENV vault — env-var revisions only (single table). */
export const envCredentialRefQuery = (db: Kysely<DB>, organizationId: string) =>
  db
    .selectFrom("env_var_revisions")
    .select([sql<EncryptedCredentialType>`'envVarValue'`.as("credential_type"), "id"])
    .where("organization_id", "=", organizationId);

/** The currently-wrapped DEK (+ version) for every env-var revision — the env rotation source set. */
export const envCredentialDekQuery = (db: Kysely<DB>, organizationId: string) =>
  db
    .selectFrom("env_var_revisions")
    .select([
      sql<EncryptedCredentialType>`'envVarValue'`.as("credential_type"),
      "id",
      "wrapped_dek",
      "vault_version",
    ])
    .where("organization_id", "=", organizationId);
