import { openAccountKey, sealAccountKey } from "@better-update/credentials-crypto";

import type { AccountKeyEnvelope, AccountKeyMaterial } from "@better-update/credentials-crypto";

import type { AccountKeyRequest, AccountKeyResponse } from "./account-key-worker";

// Main-thread side of the account-key ceremony: the same `openAccountKey` /
// `sealAccountKey` calls the CLI makes, but handed to a throwaway worker so the
// ~128 MiB Argon2id derivation does not block rendering (see account-key-worker.ts).
// Whenever a worker cannot run — no `Worker` at all (SSR, jsdom tests), a CSP that
// blocks it, a chunk that fails to load — the ceremony falls back to this thread:
// janky, but never a broken unlock.

const isAccountKeyResponse = (value: unknown): value is AccountKeyResponse =>
  typeof value === "object" && value !== null && "ok" in value && typeof value.ok === "boolean";

const spawnWorker = (): Worker | null => {
  if (typeof Worker === "undefined") {
    return null;
  }
  // eslint-disable-next-line functional/no-try-statements -- a blocked/unsupported worker must degrade to the main thread, not fail the ceremony
  try {
    // Vite resolves and bundles this literal path at build time (worker entry), so
    // it is a build input rather than a runtime import specifier.
    return new Worker(new URL("account-key-worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
};

/**
 * Send one request to a fresh worker, then terminate it — the worker holds the
 * passphrase and the opened private keys, so it lives exactly as long as the
 * ceremony. Resolves `null` when the worker is unusable (never constructed, failed
 * to load, answered garbage) so the caller can retry on the main thread; a crypto
 * failure comes back as a normal `ok: false` response.
 */
const askWorker = async (request: AccountKeyRequest): Promise<AccountKeyResponse | null> => {
  const worker = spawnWorker();
  if (worker === null) {
    return null;
  }
  const response = await new Promise<AccountKeyResponse | null>((resolve) => {
    worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      resolve(isAccountKeyResponse(event.data) ? event.data : null);
    });
    // A load/parse failure surfaces here and never as a message — the worker
    // reports crypto failures as `ok: false` instead.
    worker.addEventListener("error", () => {
      resolve(null);
    });
    // eslint-disable-next-line unicorn/require-post-message-target-origin -- Worker.postMessage has no targetOrigin parameter (that overload is Window.postMessage)
    worker.postMessage(request);
  });
  worker.terminate();
  return response;
};

/** Open a passphrase-sealed account escrow. Rejects on a wrong passphrase (AEAD failure). */
export const openAccountKeyOffMainThread = async (args: {
  envelope: AccountKeyEnvelope;
  passphrase: string;
}): Promise<AccountKeyMaterial> => {
  const response = await askWorker({
    op: "open",
    envelope: args.envelope,
    passphrase: args.passphrase,
  });
  if (response?.ok === true && response.op === "open") {
    return response.material;
  }
  return response?.ok === false
    ? // eslint-disable-next-line functional/no-promise-reject -- rejection is the ceremony's failure channel; unlock.ts catches it and remaps the raw AEAD message to an actionable hint
      Promise.reject(new Error(response.message))
    : openAccountKey(args);
};

/** Seal a freshly generated account keypair under the user's passphrase. */
export const sealAccountKeyOffMainThread = async (args: {
  material: AccountKeyMaterial;
  passphrase: string;
}): Promise<AccountKeyEnvelope> => {
  const response = await askWorker({
    op: "seal",
    material: args.material,
    passphrase: args.passphrase,
  });
  if (response?.ok === true && response.op === "seal") {
    return response.envelope;
  }
  return response?.ok === false
    ? // eslint-disable-next-line functional/no-promise-reject -- rejection is the ceremony's failure channel; the enroll mutation surfaces it as a toast
      Promise.reject(new Error(response.message))
    : sealAccountKey(args);
};
