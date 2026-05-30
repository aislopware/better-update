import { createSign } from "node:crypto";

import { env } from "cloudflare:test";
import { Effect } from "effect";

import { CryptoServiceLive } from "../../src/cloudflare/crypto-service";
import { CryptoService } from "../../src/domain/crypto-service";
import {
  TEST_CODE_SIGNING_CERTIFICATE_PEM,
  TEST_CODE_SIGNING_PRIVATE_KEY_PEM,
} from "../helpers/code-signing-fixture";
import { runWithLayerAndEnv } from "../helpers/runtime";

// Exercise the REAL Web Crypto verify + node:crypto X509Certificate SPKI export
// path (no stub). Sign with the fixed fixture key (node:crypto createSign works
// under nodejs_compat in the workerd pool) and verify with the matching cert.
const PAYLOAD = '{"id":"u1","launchAsset":{"url":"https://api/x"}}';

const signWith = (privateKeyPem: string, payload: string) =>
  createSign("RSA-SHA256").update(payload, "utf8").sign(privateKeyPem, "base64");

const verify = (params: {
  readonly certificatePem: string;
  readonly payload: string;
  readonly signatureBase64: string;
}) =>
  runWithLayerAndEnv(
    Effect.gen(function* () {
      const crypto = yield* CryptoService;
      return yield* crypto.rsaPkcs1Sha256Verify(params);
    }),
    CryptoServiceLive,
    env,
  );

describe("CryptoService.rsaPkcs1Sha256Verify", () => {
  it("returns true for a signature produced by the matching key over the same bytes", async () => {
    const signatureBase64 = signWith(TEST_CODE_SIGNING_PRIVATE_KEY_PEM, PAYLOAD);
    const ok = await verify({
      certificatePem: TEST_CODE_SIGNING_CERTIFICATE_PEM,
      payload: PAYLOAD,
      signatureBase64,
    });
    expect(ok).toBe(true);
  });

  it("returns false for tampered payload bytes", async () => {
    const signatureBase64 = signWith(TEST_CODE_SIGNING_PRIVATE_KEY_PEM, PAYLOAD);
    const ok = await verify({
      certificatePem: TEST_CODE_SIGNING_CERTIFICATE_PEM,
      payload: `${PAYLOAD} `,
      signatureBase64,
    });
    expect(ok).toBe(false);
  });

  it("returns false when the signature is for a different payload", async () => {
    const signatureBase64 = signWith(TEST_CODE_SIGNING_PRIVATE_KEY_PEM, '{"id":"other"}');
    const ok = await verify({
      certificatePem: TEST_CODE_SIGNING_CERTIFICATE_PEM,
      payload: PAYLOAD,
      signatureBase64,
    });
    expect(ok).toBe(false);
  });
});
