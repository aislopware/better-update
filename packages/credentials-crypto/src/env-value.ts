import { fromBase64, toBase64 } from "@better-update/encoding";

import { openCredential, SCHEMA_VERSION, sealCredential } from "./credential";
import { generateDek, unwrapDek, wrapDek } from "./vault";

import type { VaultKind } from "./vault";

/**
 * Browser-safe seal/open for ENV-VAR VALUES. Env values are stored as ordinary
 * credential blobs of type `envVarValue` (metadata `{key, environment}`, secret
 * `{value}`), so this is a thin, runtime-agnostic orchestration over the shared
 * credential + DEK primitives — byte-for-byte identical to the CLI's Effect-based
 * `sealForUpload`/`openFromDownload` for the same type. The web env-vault unlock
 * path uses it directly (no Effect, no Node/keyring deps); the CLI keeps its
 * Effect wrappers over the same primitives. Keeping the envelope shape here (one
 * place) is what guarantees the two clients stay interoperable.
 */

const ENV_VAR_CREDENTIAL_TYPE = "envVarValue";

/** The opaque, base64 envelope fields the server stores for an env-var value revision. */
export interface EnvValueEnvelope {
  /** The credential id bound into the ciphertext + DEK wrap (the server row id). */
  readonly id: string;
  readonly ciphertext: string;
  readonly wrappedDek: string;
  readonly vaultVersion: number;
  readonly vaultKind: VaultKind;
}

/** A decrypted env value plus the metadata sealed alongside it (for swap-detection). */
export interface OpenedEnvValue {
  readonly value: string;
  readonly key: string;
  readonly environment: string;
}

/**
 * Seal an env-var value for upload: fresh DEK, AEAD-seal the typed payload, wrap
 * the DEK under the (env) vault key — all bound to `(org, credentialId,
 * vaultVersion, vaultKind)` so the server can neither mix envelopes nor accept a
 * cross-vault write.
 */
export const sealEnvValue = (args: {
  readonly vaultKey: Uint8Array;
  readonly vaultVersion: number;
  readonly vaultKind: VaultKind;
  readonly orgId: string;
  readonly key: string;
  readonly environment: string;
  readonly value: string;
}): EnvValueEnvelope => {
  const credentialId = crypto.randomUUID();
  const dek = generateDek();
  const ciphertext = sealCredential({
    dek,
    payload: {
      schemaVersion: SCHEMA_VERSION,
      orgId: args.orgId,
      credentialId,
      credentialType: ENV_VAR_CREDENTIAL_TYPE,
      metadata: { key: args.key, environment: args.environment },
      secret: { value: args.value },
    },
  });
  const wrappedDek = wrapDek({
    dek,
    vaultKey: args.vaultKey,
    binding: {
      orgId: args.orgId,
      credentialId,
      vaultVersion: args.vaultVersion,
      vaultKind: args.vaultKind,
    },
  });
  return {
    id: credentialId,
    ciphertext: toBase64(ciphertext),
    wrappedDek: toBase64(wrappedDek),
    vaultVersion: args.vaultVersion,
    vaultKind: args.vaultKind,
  };
};

/** Narrow the decrypted payload to `{ secret: { value }, metadata: { key, environment } }`. */
const extractEnvValue = (parsed: unknown): OpenedEnvValue => {
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "secret" in parsed &&
    typeof parsed.secret === "object" &&
    parsed.secret !== null &&
    "value" in parsed.secret &&
    typeof parsed.secret.value === "string" &&
    "metadata" in parsed &&
    typeof parsed.metadata === "object" &&
    parsed.metadata !== null &&
    "key" in parsed.metadata &&
    typeof parsed.metadata.key === "string" &&
    "environment" in parsed.metadata &&
    typeof parsed.metadata.environment === "string"
  ) {
    return {
      value: parsed.secret.value,
      key: parsed.metadata.key,
      environment: parsed.metadata.environment,
    };
  }
  // eslint-disable-next-line functional/no-throw-statements -- crypto leaf surfaces an integrity/shape failure as an exception (mirrors openCredential/openAccountKey); callers wrap it
  throw new Error("Decrypted env value has an unexpected shape.");
};

/**
 * Decrypt an env-var value envelope. Throws (propagated AEAD failure) on a wrong
 * key, a cross-vault wrap, a stale version, or a tampered blob — the binding is
 * re-checked as AAD. Returns the value plus its sealed metadata so the caller can
 * cross-check `key`/`environment` against the server row (swap detection).
 */
export const openEnvValue = (args: {
  readonly vaultKey: Uint8Array;
  readonly orgId: string;
  readonly credentialId: string;
  readonly ciphertext: string;
  readonly wrappedDek: string;
  readonly vaultVersion: number;
  readonly vaultKind: VaultKind;
}): OpenedEnvValue => {
  const dek = unwrapDek({
    wrappedDek: fromBase64(args.wrappedDek),
    vaultKey: args.vaultKey,
    binding: {
      orgId: args.orgId,
      credentialId: args.credentialId,
      vaultVersion: args.vaultVersion,
      vaultKind: args.vaultKind,
    },
  });
  const parsed = openCredential({
    dek,
    ciphertext: fromBase64(args.ciphertext),
    expect: {
      schemaVersion: SCHEMA_VERSION,
      orgId: args.orgId,
      credentialId: args.credentialId,
      credentialType: ENV_VAR_CREDENTIAL_TYPE,
    },
  });
  return extractEnvValue(parsed);
};
