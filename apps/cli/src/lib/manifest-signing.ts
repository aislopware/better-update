import { createSign, createVerify, X509Certificate } from "node:crypto";

import { buildExpoSignatureHeader } from "@better-update/expo-codesign";
import { buildManifest } from "@better-update/expo-protocol";
import { Effect } from "effect";

import type { ManifestAssetData, ManifestUpdateData } from "@better-update/expo-protocol";

import { UpdatePublishError } from "./exit-codes";

/**
 * Render the manifest the CLI will sign. The launch asset URL points at the
 * Worker bundle route (via the shared `buildManifest` + `serverBaseUrl`/
 * `projectId`) so signed updates negotiate bsdiff patches just like unsigned
 * ones (Gap-D fix). The returned string is the EXACT byte string that is both
 * signed AND sent as `manifestBody` — there is no second `JSON.stringify`
 * between render and sign, so the signed bytes are precisely the served bytes.
 */
export const renderManifest = (params: {
  readonly update: ManifestUpdateData;
  readonly assets: readonly ManifestAssetData[];
  readonly assetBaseUrl: string;
  readonly serverBaseUrl: string;
  readonly projectId: string;
}): string =>
  JSON.stringify(
    buildManifest({
      update: params.update,
      assets: params.assets,
      assetBaseUrl: params.assetBaseUrl,
      serverBaseUrl: params.serverBaseUrl,
      projectId: params.projectId,
    }),
  );

/**
 * Sign the manifest body bytes with the developer's RSA private key and return
 * the full `expo-signature` SFV string (`sig=…, keyid=…, alg=rsa-v1_5-sha256`).
 *
 * Uses node:crypto `RSA-SHA256` (RSASSA-PKCS1-v1_5 + SHA-256) over the UTF-8
 * bytes of the body — byte-identical to `@expo/code-signing-certificates`'
 * `signBufferRSASHA256AndVerify` and to what the device re-hashes (Android
 * `bodyString.toByteArray()` / iOS `signedData`, both UTF-8). node:crypto is
 * chosen over the Expo lib because it needs no extra dep and the digests match
 * for ALL inputs (including non-ASCII), since `Buffer.from(s, "utf8")` already
 * yields the UTF-8 bytes.
 *
 * Before returning, SELF-VERIFIES the signature against the certificate's public
 * key (mirroring `signBufferRSASHA256AndVerify`): if the private key does not
 * match the certificate the signature would be unverifiable on-device, so we
 * fail locally with a clear error instead of publishing a permanently-broken
 * signed update.
 */
export const signBody = (params: {
  readonly bodyBytes: string;
  readonly privateKeyPem: string;
  readonly certificatePem: string;
  readonly keyid: string;
}): Effect.Effect<{ readonly signature: string }, UpdatePublishError> =>
  Effect.gen(function* () {
    // Sign + self-verify in one try (both can throw on malformed key/cert).
    const { sig, verified } = yield* Effect.try({
      try: () => {
        const signature = createSign("RSA-SHA256")
          .update(params.bodyBytes, "utf8")
          .sign(params.privateKeyPem, "base64");
        // Self-verify with the cert public key — the same way the device verifies.
        const certPublicKey = new X509Certificate(params.certificatePem).publicKey;
        const ok = createVerify("RSA-SHA256")
          .update(params.bodyBytes, "utf8")
          .verify(certPublicKey, signature, "base64");
        return { sig: signature, verified: ok };
      },
      catch: (cause) =>
        new UpdatePublishError({
          message: `Failed to code-sign the rendered manifest: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        }),
    });

    if (!verified) {
      return yield* new UpdatePublishError({
        message:
          "The produced signature does not verify against the provided certificate (private key / certificate mismatch). Refusing to publish an unverifiable signed update.",
      });
    }

    return {
      signature: buildExpoSignatureHeader({ sig, keyid: params.keyid }),
    };
  });
