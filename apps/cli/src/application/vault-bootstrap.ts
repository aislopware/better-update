import {
  generateIdentity,
  generateVaultKey,
  wrapVaultKey,
} from "@better-update/credentials-crypto";
import { toBase64 } from "@better-update/encoding";
import { Effect } from "effect";

import { wrapEnvKeyToRecipients } from "./env-vault-rekey";

import type { ApiClient } from "../services/api-client";

/** Label given to the org's one offline break-glass recovery recipient. */
const RECOVERY_LABEL = "Offline recovery key";

/**
 * The result of bootstrapping an org vault. `vaultKey` + `vaultVersion` let the
 * caller proceed to encrypt immediately without a second unlock round-trip;
 * `recoveryPrivateKey` MUST be shown to the operator exactly once and stored
 * offline — it is never written to disk or sent to the server.
 */
export interface BootstrappedVault {
  readonly vaultKey: Uint8Array;
  readonly vaultVersion: number;
  readonly keyId: string;
  readonly recoveryPrivateKey: string;
  readonly recoveryFingerprint: string;
}

export interface BootstrapVaultArgs {
  readonly api: ApiClient;
  /** The caller's already-registered device recipient id (the first vault holder). */
  readonly deviceKeyId: string;
  /** The caller's device age recipient (`age1...`) the vault key is wrapped to. */
  readonly deviceRecipient: string;
}

/**
 * Bootstrap the org vault on first use: generate the org vault key locally, mint
 * an offline recovery recipient, wrap the vault key to BOTH the caller's device
 * and the recovery key, and POST the initial wrap rows. The org is "born forked" —
 * a second, INDEPENDENT env-vault key is generated and wrapped to the same device +
 * recovery recipients in the same call, so the env vault is the default and
 * `env-vault migrate` is never needed. The server requires both a `recovery`
 * recipient (break-glass) and the env wraps. Returns the unlocked vault key plus
 * the recovery private key for a one-time, offline-only display.
 */
export const bootstrapVault = (args: BootstrapVaultArgs) =>
  Effect.gen(function* () {
    const vaultKey = generateVaultKey();
    // The env vault gets its OWN key — never the credentials key. Reusing it would
    // let a credentials-only recipient derive the env key, collapsing the split.
    const envVaultKey = generateVaultKey();
    const recovery = yield* Effect.promise(async () => generateIdentity());

    // The recovery recipient must be registered before the bootstrap call (its id
    // goes into the wrap rows below). If two members race the first-time init, the
    // loser's `orgVault.bootstrap` fails `Conflict` and this recovery key is left
    // registered but unused. That is harmless — it is wrapped into no vault, so it
    // grants nothing — and there is no key-delete endpoint to undo it; we accept
    // the orphan rather than add one solely for this cold path.
    const recoveryKey = yield* args.api.userEncryptionKeys.register({
      payload: {
        kind: "recovery",
        publicKey: recovery.publicKey,
        label: RECOVERY_LABEL,
        fingerprint: recovery.fingerprint,
      },
    });

    const [deviceWrap, recoveryWrap] = yield* Effect.all([
      Effect.promise(async () => wrapVaultKey({ vaultKey, recipient: args.deviceRecipient })),
      Effect.promise(async () => wrapVaultKey({ vaultKey, recipient: recovery.publicKey })),
    ]);

    // The env key wrapped to the same two recipients (device + recovery) — the
    // genesis env recipient set. Account keys join later via web/CLI enrollment.
    const envWraps = yield* wrapEnvKeyToRecipients(envVaultKey, [
      { recipientKind: "device", recipientId: args.deviceKeyId, recipient: args.deviceRecipient },
      { recipientKind: "recovery", recipientId: recoveryKey.id, recipient: recovery.publicKey },
    ]);

    const vault = yield* args.api.orgVault.bootstrap({
      payload: {
        wraps: [
          { userEncryptionKeyId: args.deviceKeyId, wrappedKey: toBase64(deviceWrap) },
          { userEncryptionKeyId: recoveryKey.id, wrappedKey: toBase64(recoveryWrap) },
        ],
        envWraps,
      },
    });

    return {
      vaultKey,
      vaultVersion: vault.vaultVersion,
      keyId: args.deviceKeyId,
      recoveryPrivateKey: recovery.privateKey,
      recoveryFingerprint: recovery.fingerprint,
    } satisfies BootstrappedVault;
  });
