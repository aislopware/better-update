import {
  CODE_SIGNING_ALG,
  extractLeafCertificatePem,
  isExpoSignatureParseFailure,
  parseExpoSignatureHeader,
} from "@better-update/expo-codesign";
import { Effect } from "effect";

import { BadRequest } from "../errors";
import { CryptoService } from "./crypto-service";

/**
 * Verify a code-signed update at PUBLISH time so an unverifiable or wrong-alg
 * signed update is REJECTED before it can ever be stored + served as
 * permanently-unverifiable on-device.
 *
 * Only runs when a `signature` is present — unsigned updates skip entirely.
 *
 * Steps:
 *  (a) Parse the stored `signature` as an `expo-signature` SFV dictionary;
 *      reject if it is not a valid dictionary carrying a string `sig`.
 *  (b) Require `alg === rsa-v1_5-sha256` (the ONLY value SDK56 verifies, default
 *      when absent — mirroring the device's `parseFromString(null) => RSA_SHA256`).
 *      Any other alg (notably ECDSA) is rejected — this gates ECDSA OFF the wire.
 *  (c) Require a certificate chain (a signed update with no chain can never be
 *      device-verified) and extract the leaf cert (first PEM block).
 *  (d) The signed body bytes are `manifestBody ?? directiveBody` — the exact
 *      bytes that will be served verbatim on the signed part.
 *  (e) Verify the signature against the leaf cert's public key. A false result OR
 *      a CryptoError (malformed cert/sig) is rejected.
 */
export const verifySignedUpdate = (params: {
  readonly signature: string | null;
  readonly certificateChain: string | null;
  readonly manifestBody: string | null;
  readonly directiveBody: string | null;
}): Effect.Effect<void, BadRequest, CryptoService> =>
  Effect.gen(function* () {
    const { signature } = params;
    // Unsigned updates skip verification entirely.
    if (signature !== null) {
      const parsed = parseExpoSignatureHeader(signature);
      if (isExpoSignatureParseFailure(parsed)) {
        return yield* new BadRequest({
          message: "signature header is not a valid expo-signature SFV dictionary",
        });
      }

      // Absent alg defaults to rsa-v1_5-sha256 (device default); any explicit
      // other value is rejected so ECDSA never reaches a verify path.
      const alg = parsed.alg ?? CODE_SIGNING_ALG;
      if (alg !== CODE_SIGNING_ALG) {
        return yield* new BadRequest({
          message: `unsupported code-signing alg: ${alg}; only ${CODE_SIGNING_ALG} is accepted`,
        });
      }

      if (!params.certificateChain) {
        return yield* new BadRequest({
          message: "code-signed update is missing a certificate chain; cannot be verified",
        });
      }
      const leaf = extractLeafCertificatePem(params.certificateChain);
      if (leaf === undefined) {
        return yield* new BadRequest({
          message: "certificate chain does not contain a PEM certificate block",
        });
      }

      const body = params.manifestBody ?? params.directiveBody;
      if (body === null) {
        return yield* new BadRequest({
          message: "code-signed update has a signature but no manifest or directive body to verify",
        });
      }

      const crypto = yield* CryptoService;
      const verified = yield* crypto
        .rsaPkcs1Sha256Verify({
          certificatePem: leaf,
          payload: body,
          signatureBase64: parsed.sig,
        })
        .pipe(Effect.catchTag("CryptoError", () => Effect.succeed(false)));

      if (!verified) {
        return yield* new BadRequest({
          message:
            "code-signing signature does not verify against the provided certificate; refusing to store an unverifiable signed update",
        });
      }
    }
  });
