import {
  generateDek,
  openCredential,
  SCHEMA_VERSION,
  sealCredential,
  unwrapDek,
  wrapDek,
} from "@better-update/credentials-crypto";
import { fromBase64, toBase64 } from "@better-update/encoding";
import { Effect, Schema } from "effect";

import type { CredentialPayload } from "@better-update/credentials-crypto";

import { IdentityError } from "../lib/exit-codes";
import { unlockVaultKey, unlockVaultKeyInteractive } from "./vault-access";

import type { ApiClient } from "../services/api-client";
import type { UnlockedVault } from "./vault-access";

/**
 * Client-side credential encryption. The server is zero-knowledge: the CLI seals
 * the secret material into an AEAD blob, wraps the per-credential DEK under the
 * org vault key, and uploads only `{ ciphertext, wrappedDek, vaultVersion }` plus
 * public metadata. On the way back it reverses the process and re-verifies the
 * embedded metadata against the server-supplied row, failing hard on any drift.
 */

/** Decoder for the typed payload sealed inside the ciphertext. */
const CredentialPayloadSchema = Schema.Struct({
  schemaVersion: Schema.Number,
  orgId: Schema.String,
  credentialId: Schema.String,
  credentialType: Schema.String,
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  secret: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

const decodePayload = Schema.decodeUnknown(CredentialPayloadSchema);

/** The opaque client-encrypted fields the server stores and relays verbatim. */
export interface EnvelopeFields {
  readonly ciphertext: string;
  readonly wrappedDek: string;
  readonly vaultVersion: number;
}

/** The client-encrypted envelope uploaded alongside a credential's public metadata. */
export interface CredentialEnvelope extends EnvelopeFields {
  readonly id: string;
}

/** Resolve the active org for this token; every credential is bound to it. */
export const getActiveOrgId = (api: ApiClient) =>
  Effect.gen(function* () {
    const me = yield* api.me.get();
    if (me.activeOrganization === null) {
      return yield* new IdentityError({ message: "No active organization for this token." });
    }
    return me.activeOrganization.id;
  });

/**
 * An unlocked vault key plus the org it is bound to, resolved once and threaded
 * into the seal/open helpers below. Resolving it a single time per command is the
 * point: the unlock does a network round-trip and (for an on-disk identity) an
 * Argon2id derivation, so a multi-credential flow that re-unlocked per credential
 * paid both N times. Seal/open are pure crypto once the session is in hand.
 */
export interface VaultSession {
  readonly orgId: string;
  readonly vault: UnlockedVault;
}

/** Resolve the active org id and unlock this device's vault key — the once-per-command I/O. */
export const openVaultSession = (api: ApiClient, passphrase: string | undefined) =>
  Effect.gen(function* () {
    const orgId = yield* getActiveOrgId(api);
    const vault = yield* unlockVaultKey(api, passphrase);
    return { orgId, vault } satisfies VaultSession;
  });

/**
 * {@link openVaultSession} that unlocks the vault key interactively — reusing the
 * OS-keychain-cached key when one is live (no prompt), prompting for the device
 * passphrase only on a cache miss, and none at all for the CI env key.
 */
export const openVaultSessionInteractive = (api: ApiClient) =>
  Effect.gen(function* () {
    const orgId = yield* getActiveOrgId(api);
    const vault = yield* unlockVaultKeyInteractive(api);
    return { orgId, vault } satisfies VaultSession;
  });

/** Reshape a sealed envelope into the `{ id, …opaque fields }` an upload body carries. */
export const toUploadEnvelope = (envelope: CredentialEnvelope) => ({
  id: envelope.id,
  ciphertext: envelope.ciphertext,
  wrappedDek: envelope.wrappedDek,
  vaultVersion: envelope.vaultVersion,
});

export interface SealForUploadArgs {
  readonly session: VaultSession;
  readonly credentialType: string;
  readonly metadata: Record<string, unknown>;
  readonly secret: Record<string, unknown>;
}

/**
 * Seal a credential for upload: generate a fresh DEK, encrypt the typed payload,
 * and wrap the DEK under the session's vault key — all bound (AAD) to
 * `(org, credentialId, type, schemaVersion)` so the server cannot mix envelopes.
 */
export const sealForUpload = (
  args: SealForUploadArgs,
): Effect.Effect<CredentialEnvelope, IdentityError> =>
  Effect.gen(function* () {
    const { orgId, vault } = args.session;
    const credentialId = crypto.randomUUID();
    const dek = generateDek();
    const payload: CredentialPayload = {
      schemaVersion: SCHEMA_VERSION,
      orgId,
      credentialId,
      credentialType: args.credentialType,
      metadata: args.metadata,
      secret: args.secret,
    };
    const sealed = yield* Effect.try({
      try: () => ({
        ciphertext: sealCredential({ dek, payload }),
        wrappedDek: wrapDek({
          dek,
          vaultKey: vault.vaultKey,
          binding: { orgId, credentialId, vaultVersion: vault.vaultVersion },
        }),
      }),
      catch: () =>
        new IdentityError({ message: "Failed to encrypt the credential before upload." }),
    });
    return {
      id: credentialId,
      ciphertext: toBase64(sealed.ciphertext),
      wrappedDek: toBase64(sealed.wrappedDek),
      vaultVersion: vault.vaultVersion,
    } satisfies CredentialEnvelope;
  });

interface OpenEnvelopeArgs {
  readonly session: VaultSession;
  readonly credentialType: string;
  readonly credentialId: string;
  readonly envelope: EnvelopeFields;
  /** Plaintext metadata fields the server returned; re-checked against the sealed copy. */
  readonly serverMetadata: Record<string, unknown>;
}

/**
 * Decrypt a credential envelope and return its `secret`. Lower-level than
 * {@link openFromDownload}: the caller supplies `credentialId` explicitly, so it
 * also serves the build-resolve flow whose result carries the id out-of-band.
 */
export const openEnvelope = (
  args: OpenEnvelopeArgs,
): Effect.Effect<Record<string, unknown>, IdentityError> =>
  Effect.gen(function* () {
    const { orgId, vault } = args.session;
    const dek = yield* Effect.try({
      try: () =>
        unwrapDek({
          wrappedDek: fromBase64(args.envelope.wrappedDek),
          vaultKey: vault.vaultKey,
          binding: {
            orgId,
            credentialId: args.credentialId,
            vaultVersion: args.envelope.vaultVersion,
          },
        }),
      catch: () =>
        new IdentityError({
          message:
            "Could not unwrap this credential's key — vault access may have been rotated or revoked.",
        }),
    });
    const parsedUnknown = yield* Effect.try({
      try: () =>
        openCredential({
          dek,
          ciphertext: fromBase64(args.envelope.ciphertext),
          expect: {
            schemaVersion: SCHEMA_VERSION,
            orgId,
            credentialId: args.credentialId,
            credentialType: args.credentialType,
          },
        }),
      catch: () =>
        new IdentityError({
          message: "Credential failed integrity check (wrong key or tampered blob).",
        }),
    });
    const parsed = yield* decodePayload(parsedUnknown).pipe(
      Effect.mapError(
        () => new IdentityError({ message: "Decrypted credential has an unexpected shape." }),
      ),
    );
    yield* assertMetadataConsistent(parsed.metadata, args.serverMetadata);
    return parsed.secret;
  });

/**
 * Fail if any plaintext metadata value the server returned disagrees with the
 * sealed copy. Only fields the sealed payload also carries are cross-checked: the
 * sealed metadata is the authority, so a server field absent from it (e.g. a new
 * column added to a download response) is ignored rather than mistaken for drift,
 * and nullish server values (an absent optional) are skipped. A concrete value
 * that disagrees on a shared key is a genuine swap (serial, key id, alias…).
 */
const assertMetadataConsistent = (
  sealed: Record<string, unknown>,
  server: Record<string, unknown>,
): Effect.Effect<void, IdentityError> =>
  Effect.gen(function* () {
    for (const [key, value] of Object.entries(server)) {
      const concrete = value !== null && value !== undefined;
      if (concrete && key in sealed && sealed[key] !== value) {
        return yield* new IdentityError({
          message: "Server returned inconsistent metadata for this credential.",
        });
      }
    }
    return undefined;
  });

export interface OpenFromDownloadArgs {
  readonly session: VaultSession;
  readonly credentialType: string;
  readonly downloaded: CredentialEnvelope & Record<string, unknown>;
}

/**
 * Decrypt a credential download result and return its `secret`. The credentialId
 * is the server row id (`downloaded.id`); the remaining plaintext fields are
 * re-checked against the sealed metadata.
 */
export const openFromDownload = (args: OpenFromDownloadArgs) => {
  const { id, ciphertext, wrappedDek, vaultVersion, ...serverMetadata } = args.downloaded;
  return openEnvelope({
    session: args.session,
    credentialType: args.credentialType,
    credentialId: id,
    envelope: { ciphertext, wrappedDek, vaultVersion },
    serverMetadata,
  });
};
