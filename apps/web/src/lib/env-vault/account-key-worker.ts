import { openAccountKey, sealAccountKey } from "@better-update/credentials-crypto";

import type { AccountKeyEnvelope, AccountKeyMaterial } from "@better-update/credentials-crypto";

/**
 * Dedicated worker for the account-key passphrase ceremony (unlock + enroll).
 *
 * Both operations are dominated by Argon2id at ~128 MiB (`ACCOUNT_ARGON2_PARAMS`)
 * in pure JS — seconds of straight-line CPU — so on the main thread they froze the
 * whole tab: the dialog's spinner never painted and the unlock looked hung. Off the
 * main thread the UI keeps rendering while the KEK derives.
 *
 * This file is an ENTRY POINT: `account-key.ts` instantiates it with
 * `new Worker(new URL(…))` and terminates it after a single request, so neither the
 * passphrase nor the opened private keys outlive the ceremony. Import it only for
 * its types — importing it for effect would register this handler on the page.
 * Everything crossing `postMessage` stays inside this origin (the isolated vault
 * origin, see `host.ts`) and is never persisted.
 */

/** One ceremony per worker: open an escrow with a passphrase, or seal a new key under one. */
export type AccountKeyRequest =
  | { readonly op: "open"; readonly envelope: AccountKeyEnvelope; readonly passphrase: string }
  | { readonly op: "seal"; readonly material: AccountKeyMaterial; readonly passphrase: string };

/**
 * A success echoes the `op` so the caller can narrow the payload without a cast. A
 * crypto failure (a wrong passphrase surfaces as a bare AEAD "invalid tag") comes
 * back as `ok: false`; the worker's `error` event is left to mean the worker itself
 * could not run, which is the caller's cue to fall back to the main thread.
 */
export type AccountKeyResponse =
  | { readonly ok: true; readonly op: "open"; readonly material: AccountKeyMaterial }
  | { readonly ok: true; readonly op: "seal"; readonly envelope: AccountKeyEnvelope }
  | { readonly ok: false; readonly message: string };

const runRequest = async (request: AccountKeyRequest): Promise<AccountKeyResponse> => {
  // eslint-disable-next-line functional/no-try-statements -- the crypto leaves signal failure by throwing; carry it back over postMessage as a value
  try {
    return request.op === "open"
      ? {
          ok: true,
          op: "open",
          material: await openAccountKey({
            envelope: request.envelope,
            passphrase: request.passphrase,
          }),
        }
      : {
          ok: true,
          op: "seal",
          envelope: sealAccountKey({
            material: request.material,
            passphrase: request.passphrase,
          }),
        };
  } catch (error: unknown) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
};

globalThis.addEventListener("message", (event: MessageEvent<AccountKeyRequest>) => {
  // eslint-disable-next-line no-void -- a DOM event listener cannot be async; runRequest never rejects, so this is a deliberate fire-and-forget
  void runRequest(event.data).then((response) => {
    // eslint-disable-next-line unicorn/require-post-message-target-origin -- a worker replying to its own page has no targetOrigin parameter (that overload is Window.postMessage)
    globalThis.postMessage(response);
  });
});
