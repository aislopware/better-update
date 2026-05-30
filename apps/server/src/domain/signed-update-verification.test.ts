import { buildExpoSignatureHeader } from "@better-update/expo-codesign";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import { CryptoError, CryptoService } from "./crypto-service";
import { verifySignedUpdate } from "./signed-update-verification";

import type { CryptoServiceImpl } from "./crypto-service";

const CERT_CHAIN = "-----BEGIN CERTIFICATE-----\nLEAF\n-----END CERTIFICATE-----";
const MANIFEST_BODY = '{"id":"u1","launchAsset":{}}';

// Stub CryptoService per @effect/vitest — no vi.mock. Only rsaPkcs1Sha256Verify
// is exercised; the other members are present to satisfy the port shape but
// never invoked in these tests.
const makeCrypto = (overrides: Partial<CryptoServiceImpl>): CryptoServiceImpl => ({
  sha256Hex: () => Effect.succeed(""),
  sha256Fraction: () => Effect.succeed(0),
  hmacSignBase64Url: () => Effect.succeed(""),
  hmacVerifyBase64Url: () => Effect.succeed(false),
  rsaPkcs1Sha256Verify: () => Effect.die("rsaPkcs1Sha256Verify should not be called"),
  ...overrides,
});

const signature = buildExpoSignatureHeader({ sig: "c2ln", keyid: "main" });

describe(verifySignedUpdate, () => {
  it.effect("passes when the signature verifies against the certificate", () =>
    Effect.gen(function* () {
      let called = false;
      const crypto = makeCrypto({
        rsaPkcs1Sha256Verify: (params) => {
          called = true;
          expect(params.certificatePem).toContain("LEAF");
          expect(params.payload).toBe(MANIFEST_BODY);
          expect(params.signatureBase64).toBe("c2ln");
          return Effect.succeed(true);
        },
      });

      yield* verifySignedUpdate({
        signature,
        certificateChain: CERT_CHAIN,
        manifestBody: MANIFEST_BODY,
        directiveBody: null,
      }).pipe(Effect.provideService(CryptoService, crypto));

      expect(called).toBe(true);
    }),
  );

  it.effect("rejects a wrong alg and NEVER calls CryptoService (ECDSA gated off)", () =>
    Effect.gen(function* () {
      const crypto = makeCrypto({
        rsaPkcs1Sha256Verify: () => Effect.die("must not be called for a wrong alg"),
      });
      const ecdsaSig = buildExpoSignatureHeader({
        sig: "c2ln",
        keyid: "main",
        alg: "ecdsa-p256-sha256",
      });

      const result = yield* Effect.either(
        verifySignedUpdate({
          signature: ecdsaSig,
          certificateChain: CERT_CHAIN,
          manifestBody: MANIFEST_BODY,
          directiveBody: null,
        }).pipe(Effect.provideService(CryptoService, crypto)),
      );

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("BadRequest");
        expect(result.left.message).toContain("rsa-v1_5-sha256");
      }
    }),
  );

  it.effect("rejects a malformed SFV signature string", () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(
        verifySignedUpdate({
          signature: "\u0000 not a valid sfv dictionary",
          certificateChain: CERT_CHAIN,
          manifestBody: MANIFEST_BODY,
          directiveBody: null,
        }).pipe(Effect.provideService(CryptoService, makeCrypto({}))),
      );

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left.message).toContain("expo-signature SFV");
      }
    }),
  );

  it.effect("rejects when the certificate chain is missing", () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(
        verifySignedUpdate({
          signature,
          certificateChain: null,
          manifestBody: MANIFEST_BODY,
          directiveBody: null,
        }).pipe(Effect.provideService(CryptoService, makeCrypto({}))),
      );

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left.message).toContain("certificate chain");
      }
    }),
  );

  it.effect("rejects when CryptoService reports a signature mismatch", () =>
    Effect.gen(function* () {
      const crypto = makeCrypto({ rsaPkcs1Sha256Verify: () => Effect.succeed(false) });

      const result = yield* Effect.either(
        verifySignedUpdate({
          signature,
          certificateChain: CERT_CHAIN,
          manifestBody: MANIFEST_BODY,
          directiveBody: null,
        }).pipe(Effect.provideService(CryptoService, crypto)),
      );

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left.message).toContain("does not verify");
      }
    }),
  );

  it.effect("rejects (treats as mismatch) when CryptoService raises a CryptoError", () =>
    Effect.gen(function* () {
      const crypto = makeCrypto({
        rsaPkcs1Sha256Verify: () =>
          Effect.fail(new CryptoError({ operation: "rsaPkcs1Sha256Verify", cause: "bad cert" })),
      });

      const result = yield* Effect.either(
        verifySignedUpdate({
          signature,
          certificateChain: CERT_CHAIN,
          manifestBody: MANIFEST_BODY,
          directiveBody: null,
        }).pipe(Effect.provideService(CryptoService, crypto)),
      );

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("BadRequest");
      }
    }),
  );

  it.effect("is a no-op when no signature is present (unsigned update)", () =>
    verifySignedUpdate({
      signature: null,
      certificateChain: null,
      manifestBody: MANIFEST_BODY,
      directiveBody: null,
    }).pipe(Effect.provideService(CryptoService, makeCrypto({}))),
  );
});
