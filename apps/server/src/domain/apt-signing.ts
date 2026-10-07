/**
 * A project's APT repository signing key and the signed `InRelease` it
 * makes. The key is an Ed25519 OpenPGP key derived from the server's
 * `APT_SIGNING_SECRET` and the project id, so it is never stored and every
 * Worker derives the same one; its creation time is fixed so its fingerprint
 * and published key block never change.
 */
import { toHex } from "@better-update/encoding";
import { Effect } from "effect";

import {
  armor,
  canonicalText,
  cleartextMessage,
  concatBytes,
  keyHashInput,
  publicKeyBody,
  publicKeyPacket,
  SIGNATURE_TYPE,
  signatureHashInput,
  signaturePacket,
  userIdHashInput,
  userIdPacket,
} from "../lib/openpgp";
import { CryptoService } from "./crypto-service";

import type { SignatureParams } from "../lib/openpgp";
import type { CryptoError } from "./crypto-service";

/** Every project's key is created at this instant; signatures always come later. */
const KEY_CREATED_AT = new Date("2026-01-01T00:00:00Z");
const DERIVATION_INFO = "better-update apt signing key v1";

export interface AptSigningKey {
  /** The v4 fingerprint, upper-case hex — what `apt-key`/`gpg` print. */
  readonly fingerprint: string;
  /** The transferable public key (key, user id, self-signature), binary. */
  readonly publicKey: Uint8Array<ArrayBuffer>;
  readonly armoredPublicKey: string;
  /** `text` as an `InRelease`: cleartext-signed with SHA-512 at `now`. */
  readonly clearsign: (text: string, now: Date) => Effect.Effect<string, CryptoError>;
}

export const aptSigningKey = (params: { readonly secret: string; readonly projectId: string }) =>
  Effect.gen(function* () {
    const crypto = yield* CryptoService;
    const key = yield* crypto.deriveEd25519Key({
      secret: params.secret,
      salt: params.projectId,
      info: DERIVATION_INFO,
    });
    const body = publicKeyBody(key.publicKey, KEY_CREATED_AT);
    const fingerprint = yield* crypto.digest("SHA-1", keyHashInput(body));
    const sign = (data: Uint8Array, signature: SignatureParams) =>
      Effect.gen(function* () {
        const digest = yield* crypto.digest("SHA-512", signatureHashInput(data, signature));
        return signaturePacket(signature, digest, yield* key.sign(digest));
      });
    const userId = `APT repository ${params.projectId}`;
    const certification = yield* sign(concatBytes(keyHashInput(body), userIdHashInput(userId)), {
      type: SIGNATURE_TYPE.positiveCertification,
      createdAt: KEY_CREATED_AT,
      fingerprint,
      keyFlags: true,
    });
    const publicKey = concatBytes(publicKeyPacket(body), userIdPacket(userId), certification);
    const signingKey: AptSigningKey = {
      fingerprint: toHex(fingerprint).toUpperCase(),
      publicKey,
      armoredPublicKey: armor("PUBLIC KEY BLOCK", publicKey),
      clearsign: (text, now) =>
        sign(canonicalText(text), {
          type: SIGNATURE_TYPE.canonicalText,
          createdAt: now,
          fingerprint,
        }).pipe(Effect.map((signature) => cleartextMessage(text, signature))),
    };
    return signingKey;
  });
