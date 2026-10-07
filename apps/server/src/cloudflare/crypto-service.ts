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

const digest = (algorithm: "SHA-1" | "SHA-256" | "SHA-512", data: Uint8Array) =>
  tryWebCrypto(
    "digest",
    async () => new Uint8Array(await crypto.subtle.digest(algorithm, asBuffer(data))),
  );

/** PKCS #8 for an Ed25519 private key is this prefix and the 32-byte seed. */
const ED25519_PKCS8_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

const deriveEd25519Key = (params: {
  readonly secret: string;
  readonly salt: string;
  readonly info: string;
}) =>
  Effect.gen(function* () {
    const encoder = new TextEncoder();
    const seed = yield* tryWebCrypto("deriveEd25519Seed", async () => {
      const material = await crypto.subtle.importKey(
        "raw",
        encoder.encode(params.secret),
        "HKDF",
        false,
        ["deriveBits"],
      );
      return crypto.subtle.deriveBits(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: encoder.encode(params.salt),
          info: encoder.encode(params.info),
        },
        material,
        256,
      );
    });
    const pkcs8 = new Uint8Array(ED25519_PKCS8_PREFIX.length + 32);
    pkcs8.set(ED25519_PKCS8_PREFIX);
    pkcs8.set(new Uint8Array(seed), ED25519_PKCS8_PREFIX.length);
    const privateKey = yield* tryWebCrypto("importEd25519Key", async () =>
      crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"]),
    );
    const jwk = yield* tryWebCrypto("exportEd25519Key", async () =>
      crypto.subtle.exportKey("jwk", privateKey),
    );
    // An OKP JWK's `x` is the public key.
    const { x: encodedPublicKey } = jwk;
    if (encodedPublicKey === undefined) {
      return yield* new CryptoError({ operation: "exportEd25519Key", cause: "no public key" });
    }
    const publicKey = yield* decodeBase64Url("exportEd25519Key", encodedPublicKey);
    return {
      publicKey,
      sign: (message: Uint8Array) =>
        tryWebCrypto(
          "ed25519Sign",
          async () =>
            new Uint8Array(await crypto.subtle.sign("Ed25519", privateKey, asBuffer(message))),
        ),
    };
  });

export const CryptoServiceLive = Layer.succeed(CryptoService, {
  digest,
  deriveEd25519Key,
  sha256Hex,
  sha256Base64Url,
  sha256Fraction,
  hmacSignBase64Url,
  hmacVerifyBase64Url,
  rsaPkcs1Sha256Verify,
});
