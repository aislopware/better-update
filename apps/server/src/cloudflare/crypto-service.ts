// eslint-disable-next-line import/no-nodejs-modules -- cloudflare adapter is the I/O boundary; node:crypto X509Certificate is available under nodejs_compat and parses the leaf cert PEM so Web Crypto can verify (no hand-rolled ASN.1)
import { X509Certificate } from "node:crypto";

import { fromBase64, fromBase64Url, toBase64Url, toHex } from "@better-update/encoding";
import { Effect, Layer } from "effect";

import { CryptoError, CryptoService } from "../domain/crypto-service";

const asBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

const tryWebCrypto = <T>(operation: string, run: () => Promise<T>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new CryptoError({ operation, cause }),
  });

const sha256Hex = (input: string) =>
  Effect.gen(function* () {
    const buffer = yield* tryWebCrypto("sha256Hex", async () =>
      crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)),
    );
    return toHex(buffer);
  });

const sha256Base64Url = (input: string) =>
  Effect.gen(function* () {
    const buffer = yield* tryWebCrypto("sha256Base64Url", async () =>
      crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)),
    );
    return toBase64Url(buffer);
  });

const sha256Fraction = (salt: string, clientId: string) =>
  Effect.gen(function* () {
    const input = new TextEncoder().encode(`${salt}:${clientId}`);
    const buffer = yield* tryWebCrypto("sha256", async () =>
      crypto.subtle.digest("SHA-256", input),
    );
    const view = new DataView(buffer);
    return view.getUint32(0, false) / 4_294_967_296;
  });

const importHmacKey = (secret: string) =>
  tryWebCrypto("importHmacKey", async () =>
    crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    ),
  );

const decodeBase64Url = (operation: string, value: string) =>
  Effect.try({
    try: () => fromBase64Url(value),
    catch: (cause) => new CryptoError({ operation, cause }),
  });

const hmacSignBase64Url = (secret: string, payload: string) =>
  Effect.gen(function* () {
    const key = yield* importHmacKey(secret);
    const signature = yield* tryWebCrypto("hmacSign", async () =>
      crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
    );
    return toBase64Url(signature);
  });

const hmacVerifyBase64Url = (secret: string, payload: string, token: string) =>
  Effect.gen(function* () {
    const key = yield* importHmacKey(secret);
    const signatureBytes = yield* decodeBase64Url("hmacVerifyDecode", token);
    return yield* tryWebCrypto("hmacVerify", async () =>
      crypto.subtle.verify(
        "HMAC",
        key,
        asBuffer(signatureBytes),
        new TextEncoder().encode(payload),
      ),
    );
  });

// Import the leaf certificate's RSA public key as SPKI and verify the
// detached signature. node:crypto X509Certificate (available under
// nodejs_compat) parses the PEM + exports the SPKI DER, and Web Crypto does the
// RSASSA-PKCS1-v1_5 verify — no hand-rolled ASN.1.
const importLeafCertSpki = (certificatePem: string) =>
  tryWebCrypto("importLeafCertSpki", async () => {
    const der = new X509Certificate(certificatePem).publicKey.export({
      type: "spki",
      format: "der",
    });
    return crypto.subtle.importKey(
      "spki",
      asBuffer(new Uint8Array(der)),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
  });

const rsaPkcs1Sha256Verify = (params: {
  readonly certificatePem: string;
  readonly payload: string;
  readonly signatureBase64: string;
}) =>
  Effect.gen(function* () {
    const key = yield* importLeafCertSpki(params.certificatePem);
    const signatureBytes = yield* Effect.try({
      try: () => fromBase64(params.signatureBase64),
      catch: (cause) => new CryptoError({ operation: "rsaVerifyDecodeSignature", cause }),
    });
    return yield* tryWebCrypto("rsaPkcs1Sha256Verify", async () =>
      crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        key,
        asBuffer(signatureBytes),
        new TextEncoder().encode(params.payload),
      ),
    );
  });

export const CryptoServiceLive = Layer.succeed(CryptoService, {
  sha256Hex,
  sha256Base64Url,
  sha256Fraction,
  hmacSignBase64Url,
  hmacVerifyBase64Url,
  rsaPkcs1Sha256Verify,
});
