import { createSign, createVerify, X509Certificate } from "node:crypto";

import { buildExpoSignatureHeader } from "@better-update/expo-codesign";
import { buildManifest } from "@better-update/expo-protocol";
import { Effect } from "effect";

import type { ManifestAssetData, ManifestUpdateData } from "@better-update/expo-protocol";

import { UpdatePublishError, UpdateRollbackError } from "./exit-codes";

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

interface SignBodyParams {
  readonly bodyBytes: string;
  readonly privateKeyPem: string;
  readonly certificatePem: string;
  readonly keyid: string;
}

/**
 * Code-sign arbitrary Expo response-body bytes — a rendered MANIFEST or a
 * rollback DIRECTIVE — with the developer's RSA private key and return the full
 * `expo-signature` SFV string (`sig=…, keyid=…, alg=rsa-v1_5-sha256`).
 *
 * Uses node:crypto `RSA-SHA256` (RSASSA-PKCS1-v1_5 + SHA-256) over the UTF-8
 * bytes of `bodyBytes` — byte-identical to `@expo/code-signing-certificates`'
 * `signBufferRSASHA256AndVerify` and to what the device re-hashes for BOTH part
 * types (Android `bodyString.toByteArray()` / iOS `signedData`, both UTF-8; the
 * device runs one `validateSignature` over manifest and directive parts alike).
 * node:crypto is chosen over the Expo lib because it needs no extra dep and the
 * digests match for ALL inputs (including non-ASCII), since `Buffer.from(s,
 * "utf8")` already yields the UTF-8 bytes.
 *
 * Before returning, SELF-VERIFIES the signature against the certificate's public
 * key (mirroring `signBufferRSASHA256AndVerify`): if the private key does not
 * match the certificate the signature would be unverifiable on-device, so we
 * fail locally with a clear error instead of publishing a permanently-broken
 * signed update/directive. `label` + the caller's `makeError` keep the failure
 * message and the error tag accurate to what was being signed.
 *
 * SCOPE: this signs the body bytes ONLY — it does not inject any project-binding
 * (`extra.signingInfo` / `expoProjectInformation`) metadata. That matches the
 * manifest path (which never embeds `scopeKey`) and is correct for the
 * DEVELOPMENT / self-signed certificates self-hosted projects generate via
 * `expo-updates codesigning:generate` (no `expoProjectInformation` extension →
 * the device skips the project-info cross-check). EAS-issued project-scoped
 * certs are out of scope codebase-wide.
 */
const signExpoBody = <Err>(
  params: SignBodyParams & {
    readonly label: string;
    readonly makeError: (message: string) => Err;
  },
): Effect.Effect<{ readonly signature: string }, Err> =>
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
        params.makeError(
          `Failed to code-sign the ${params.label}: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        ),
    });

    if (!verified) {
      return yield* Effect.fail(
        params.makeError(
          `The produced signature does not verify against the provided certificate (private key / certificate mismatch). Refusing to publish an unverifiable signed ${params.label}.`,
        ),
      );
    }

    return {
      signature: buildExpoSignatureHeader({ sig, keyid: params.keyid }),
    };
  });

/**
 * Sign a rendered manifest body — see {@link signExpoBody}. Fails with
 * {@link UpdatePublishError} so it threads through the publish error channel.
 */
export const signBody = (
  params: SignBodyParams,
): Effect.Effect<{ readonly signature: string }, UpdatePublishError> =>
  signExpoBody({
    ...params,
    label: "rendered manifest",
    makeError: (message) => new UpdatePublishError({ message }),
  });

/**
 * Sign a `rollBackToEmbedded` directive body — see {@link signExpoBody}. The
 * device runs the SAME `validateSignature` over a directive part as a manifest
 * part, so this is the manifest signer with a directive-accurate label and the
 * rollback error tag. Fails with {@link UpdateRollbackError} so it threads
 * through the rollback error channel.
 */
export const signDirectiveBody = (
  params: SignBodyParams,
): Effect.Effect<{ readonly signature: string }, UpdateRollbackError> =>
  signExpoBody({
    ...params,
    label: "rollback directive",
    makeError: (message) => new UpdateRollbackError({ message }),
  });
