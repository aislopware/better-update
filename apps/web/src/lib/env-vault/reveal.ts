import { openEnvValue } from "@better-update/credentials-crypto";

import type { UnlockedEnvVault } from "./cache";

/** The sealed value envelope the reveal endpoint returns (`GET /api/env-vars/:id/value`). */
export interface RevealEnvelope {
  readonly id: string;
  readonly ciphertext: string;
  readonly wrappedDek: string;
  readonly vaultVersion: number;
  readonly vaultKind?: "credentials" | "env" | undefined;
}

export type RevealResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: string };

/**
 * Decrypt a revealed env-value envelope with the unlocked vault key and verify
 * the sealed `(key, environment)` match the row the user clicked — swap detection,
 * the same cross-check the CLI does in `assertMetadataConsistent`. A wrong key, a
 * stale/cross-vault wrap, or a tampered blob makes `openEnvValue` throw; this
 * returns a typed result instead so the dialog can render an inline error rather
 * than crash. The server always tells us which vault the value is sealed under
 * (`vaultKind`); the `"credentials"` fallback is only a type-narrowing default.
 */
export const revealEnvValue = (args: {
  readonly vault: UnlockedEnvVault;
  readonly orgId: string;
  readonly envelope: RevealEnvelope;
  readonly expectKey: string;
  readonly expectEnvironment: string;
}): RevealResult => {
  // eslint-disable-next-line functional/no-try-statements -- openEnvValue throws on any AEAD/shape failure; convert to a typed result for the UI
  try {
    const opened = openEnvValue({
      vaultKey: args.vault.vaultKey,
      orgId: args.orgId,
      credentialId: args.envelope.id,
      ciphertext: args.envelope.ciphertext,
      wrappedDek: args.envelope.wrappedDek,
      vaultVersion: args.envelope.vaultVersion,
      vaultKind: args.envelope.vaultKind ?? "credentials",
    });
    if (opened.key !== args.expectKey || opened.environment !== args.expectEnvironment) {
      return {
        ok: false,
        error:
          "This value's sealed key/environment does not match the row — it may have been altered on the server.",
      };
    }
    return { ok: true, value: opened.value };
  } catch {
    return {
      ok: false,
      error: "Could not decrypt this value. Re-unlock the env vault and try again.",
    };
  }
};
