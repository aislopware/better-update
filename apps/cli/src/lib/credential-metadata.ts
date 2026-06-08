import { fromHex } from "@better-update/encoding";
import { safeJsonParse } from "@better-update/safe-json";
import { Effect } from "effect";

import { CredentialValidationError } from "./exit-codes";

/**
 * Client-side credential metadata extraction. The server is zero-knowledge under
 * the E2E vault, so the public, server-visible fields (alias, fingerprints,
 * service-account identifiers) are parsed here from the plaintext file before it
 * is sealed. Ported from the former server-side parsers.
 */

// ── Android keystore ───────────────────────────────────────────────

const JKS_MAGIC = fromHex("FEEDFEED");
const PKCS12_MAGIC = fromHex("3082");

export type KeystoreFormat = "JKS" | "PKCS12";

const hasMagic = (bytes: Uint8Array, magic: Uint8Array): boolean => {
  if (bytes.byteLength < magic.byteLength) {
    return false;
  }
  return [...magic].every((byte, index) => bytes[index] === byte);
};

const detectFormat = (bytes: Uint8Array): KeystoreFormat | undefined => {
  if (hasMagic(bytes, JKS_MAGIC)) {
    return "JKS";
  }
  if (hasMagic(bytes, PKCS12_MAGIC)) {
    return "PKCS12";
  }
  return undefined;
};

export interface ValidatedKeystore {
  readonly format: KeystoreFormat;
  readonly keyAlias: string;
}

/**
 * Validate keystore bytes + alias/passwords locally before sealing. Mirrors the
 * old server check: magic-byte format detection + required-field validation.
 * Fingerprints cannot be derived from the raw bytes; they are extracted separately
 * via keytool (`extractKeystoreFingerprints` in ./android-keystore) at upload/generate
 * time and attached to the public metadata.
 */
export const validateAndroidKeystore = (params: {
  readonly bytes: Uint8Array;
  readonly keyAlias: string;
  readonly keystorePassword: string;
  readonly keyPassword: string;
}): Effect.Effect<ValidatedKeystore, CredentialValidationError> =>
  Effect.gen(function* () {
    if (params.bytes.byteLength < 16) {
      return yield* new CredentialValidationError({ message: "Keystore file too small" });
    }
    if (params.keyAlias.trim().length === 0) {
      return yield* new CredentialValidationError({ message: "Key alias is required" });
    }
    if (params.keystorePassword.length === 0 || params.keyPassword.length === 0) {
      return yield* new CredentialValidationError({
        message: "Keystore and key passwords are required",
      });
    }
    const format = detectFormat(params.bytes);
    if (format === undefined) {
      return yield* new CredentialValidationError({
        message: "Unrecognized keystore magic bytes (expected JKS or PKCS12)",
      });
    }
    return { format, keyAlias: params.keyAlias.trim() };
  });

// ── Google service account JSON ─────────────────────────────────────

export interface ParsedGoogleServiceAccountKey {
  readonly clientEmail: string;
  readonly privateKeyId: string;
  readonly googleProjectId: string;
  readonly clientId: string | null;
}

interface RawServiceAccountKey {
  readonly type?: unknown;
  readonly project_id?: unknown;
  readonly private_key_id?: unknown;
  readonly private_key?: unknown;
  readonly client_email?: unknown;
  readonly client_id?: unknown;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

/** Parse + validate a Google service-account JSON, extracting its public identifiers. */
export const parseGoogleServiceAccountKey = (
  jsonText: string,
): Effect.Effect<ParsedGoogleServiceAccountKey, CredentialValidationError> =>
  Effect.gen(function* () {
    const parsed = safeJsonParse(jsonText);
    if (parsed === null || typeof parsed !== "object") {
      return yield* new CredentialValidationError({ message: "File is not valid JSON object" });
    }
    const raw = parsed as RawServiceAccountKey;
    if (raw.type !== "service_account") {
      return yield* new CredentialValidationError({
        message: "type field must be 'service_account'",
      });
    }
    if (!isNonEmptyString(raw.project_id) || !isNonEmptyString(raw.private_key_id)) {
      return yield* new CredentialValidationError({
        message: "project_id and private_key_id are required",
      });
    }
    if (!isNonEmptyString(raw.private_key) || !raw.private_key.includes("BEGIN PRIVATE KEY")) {
      return yield* new CredentialValidationError({
        message: "private_key must be a PEM-formatted RSA key",
      });
    }
    if (!isNonEmptyString(raw.client_email) || !raw.client_email.includes("@")) {
      return yield* new CredentialValidationError({
        message: "client_email must be a service-account email",
      });
    }
    return {
      clientEmail: raw.client_email,
      privateKeyId: raw.private_key_id,
      googleProjectId: raw.project_id,
      clientId: isNonEmptyString(raw.client_id) ? raw.client_id : null,
    };
  });
