import { createPrivateKey, sign } from "node:crypto";

import { ed25519 } from "@noble/curves/ed25519.js";

import {
  parseSparklePrivateKey,
  signSparkleArchive,
  sparklePublicKeyBase64,
  verifySparkleSignature,
} from "./sparkle-signature";

import type { SparklePrivateKey } from "./sparkle-signature";

const SEED = Buffer.alloc(32, 0x2a);
const ARCHIVE = Buffer.from("an archive Sparkle downloads");

/** Node's own Ed25519 signer, the reference the Sparkle signer must match. */
const referenceSignature = (seed: Buffer, message: Buffer) =>
  sign(
    null,
    message,
    createPrivateKey({
      key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
      format: "der",
      type: "pkcs8",
    }),
  ).toString("base64");

/** The older `generate_keys` format: orlp's expanded secret followed by the public key. */
const legacyKeyFile = (seed: Buffer) => {
  const { head, prefix, pointBytes } = ed25519.utils.getExtendedPublicKey(seed);
  return Buffer.concat([head, prefix, pointBytes]).toString("base64");
};

const parsed = (text: string): SparklePrivateKey => {
  const key = parseSparklePrivateKey(text);
  if (typeof key === "string") {
    throw new TypeError(key);
  }
  return key;
};

describe(parseSparklePrivateKey, () => {
  it("rejects text that is not a key", () => {
    expect(parseSparklePrivateKey("not a key!")).toContain("not base64");
    expect(parseSparklePrivateKey(Buffer.alloc(64).toString("base64"))).toContain("64 bytes");
  });
});

describe(signSparkleArchive, () => {
  const seedKey = parsed(`${SEED.toString("base64")}\n`);
  const publicKey = sparklePublicKeyBase64(seedKey);

  it("signs with a seed exactly as RFC 8032 Ed25519 does", () => {
    const signature = signSparkleArchive(seedKey, ARCHIVE);
    expect(signature).toBe(referenceSignature(SEED, ARCHIVE));
    expect(verifySparkleSignature(publicKey, signature, ARCHIVE)).toBe(true);
  });

  it("signs with an older-format key identically to its seed", () => {
    const legacy = parsed(legacyKeyFile(SEED));
    expect(legacy.kind).toBe("expanded");
    expect(sparklePublicKeyBase64(legacy)).toBe(publicKey);
    expect(signSparkleArchive(legacy, ARCHIVE)).toBe(referenceSignature(SEED, ARCHIVE));
  });

  it("fails verification for another archive or key", () => {
    const signature = signSparkleArchive(seedKey, ARCHIVE);
    expect(verifySparkleSignature(publicKey, signature, Buffer.from("tampered"))).toBe(false);
    const other = sparklePublicKeyBase64(parsed(Buffer.alloc(32, 1).toString("base64")));
    expect(verifySparkleSignature(other, signature, ARCHIVE)).toBe(false);
    expect(verifySparkleSignature(publicKey, "garbage", ARCHIVE)).toBe(false);
  });
});
