/**
 * The few OpenPGP structures an APT repository needs, as bytes (RFC 4880 /
 * RFC 9580, version 4): an Ed25519 public key (the legacy EdDSA algorithm 22,
 * which both gpgv and Sequoia's sqv verify), a user id, signatures by it, the
 * cleartext signature framework apt reads `InRelease` in, and ASCII armor.
 * Pure: hashing and signing happen in the caller.
 */
import { toBase64 } from "@better-update/encoding";

const PUBLIC_KEY_TAG = 6;
const USER_ID_TAG = 13;
const SIGNATURE_TAG = 2;

const EDDSA_LEGACY = 22;
const SHA512 = 10;
/** The Ed25519 curve's OID, 1.3.6.1.4.1.11591.15.1. */
const ED25519_OID = [0x2b, 0x06, 0x01, 0x04, 0x01, 0xda, 0x47, 0x0f, 0x01];

export const SIGNATURE_TYPE = { canonicalText: 0x01, positiveCertification: 0x13 } as const;

const SUBPACKET = { creationTime: 2, issuerKeyId: 16, keyFlags: 27, issuerFingerprint: 33 };
const KEY_FLAGS_CERTIFY_SIGN = 0x03;

export const concatBytes = (...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  parts.reduce((offset, part) => {
    out.set(part, offset);
    return offset + part.length;
  }, 0);
  return out;
};

const be = (value: number, bytes: 2 | 4): Uint8Array => {
  const out = new Uint8Array(bytes);
  const view = new DataView(out.buffer);
  if (bytes === 2) {
    view.setUint16(0, value, false);
  } else {
    view.setUint32(0, value, false);
  }
  return out;
};

const seconds = (date: Date): Uint8Array => be(Math.floor(date.getTime() / 1000), 4);

/** A new-format packet length: one octet below 192, two below 8384, else 0xFF and four. */
const lengthOctets = (length: number): readonly number[] => {
  if (length < 192) {
    return [length];
  }
  if (length < 8384) {
    return [Math.floor((length - 192) / 256) + 192, (length - 192) % 256];
  }
  return [0xff, ...be(length, 4)];
};

/** A new-format packet: 0xC0 plus the tag, the body's length, the body. */
const packet = (tag: number, body: Uint8Array): Uint8Array =>
  concatBytes(Uint8Array.of(0xc0 + tag, ...lengthOctets(body.length)), body);

/** A multiprecision integer: its bit count, then its bytes without leading zeros. */
const mpi = (bytes: Uint8Array): Uint8Array => {
  const start = bytes.findIndex((byte) => byte !== 0);
  const trimmed = start === -1 ? new Uint8Array(0) : bytes.subarray(start);
  const [first = 0] = trimmed;
  const bits = trimmed.length === 0 ? 0 : (trimmed.length - 1) * 8 + (32 - Math.clz32(first));
  return concatBytes(be(bits, 2), trimmed);
};

/** A v4 Ed25519 public key packet's body: the point is the key prefixed by 0x40. */
export const publicKeyBody = (publicKey: Uint8Array, createdAt: Date): Uint8Array =>
  concatBytes(
    Uint8Array.of(4),
    seconds(createdAt),
    Uint8Array.of(EDDSA_LEGACY, ED25519_OID.length, ...ED25519_OID),
    mpi(concatBytes(Uint8Array.of(0x40), publicKey)),
  );

/** What a v4 fingerprint is the SHA-1 of; signatures over a key hash it too. */
export const keyHashInput = (keyBody: Uint8Array): Uint8Array =>
  concatBytes(Uint8Array.of(0x99), be(keyBody.length, 2), keyBody);

/** What a certification hashes after the key: the user id. */
export const userIdHashInput = (userId: string): Uint8Array => {
  const bytes = new TextEncoder().encode(userId);
  return concatBytes(Uint8Array.of(0xb4), be(bytes.length, 4), bytes);
};

const subpacket = (type: number, data: Uint8Array): Uint8Array =>
  concatBytes(Uint8Array.of(data.length + 1, type), data);

const subpacketArea = (subpackets: readonly Uint8Array[]): Uint8Array => {
  const body = concatBytes(...subpackets);
  return concatBytes(be(body.length, 2), body);
};

/** A signature being made: its type, when, by which key, and for a key, the flags it grants. */
export interface SignatureParams {
  readonly type: number;
  readonly createdAt: Date;
  readonly fingerprint: Uint8Array;
  readonly keyFlags?: boolean;
}

/** The signature's fields up to its hashed subpackets — hashed after the signed data. */
const hashedPart = (params: SignatureParams): Uint8Array =>
  concatBytes(
    Uint8Array.of(4, params.type, EDDSA_LEGACY, SHA512),
    subpacketArea([
      subpacket(SUBPACKET.creationTime, seconds(params.createdAt)),
      subpacket(SUBPACKET.issuerFingerprint, concatBytes(Uint8Array.of(4), params.fingerprint)),
      ...(params.keyFlags === true
        ? [subpacket(SUBPACKET.keyFlags, Uint8Array.of(KEY_FLAGS_CERTIFY_SIGN))]
        : []),
    ]),
  );

/** Everything a v4 signature's SHA-512 digest covers: the data, its hashed part, the trailer. */
export const signatureHashInput = (data: Uint8Array, params: SignatureParams): Uint8Array => {
  const hashed = hashedPart(params);
  return concatBytes(data, hashed, Uint8Array.of(0x04, 0xff), be(hashed.length, 4));
};

/** A signature packet, given the digest it signed and the Ed25519 signature of that digest. */
export const signaturePacket = (
  params: SignatureParams,
  digest: Uint8Array,
  signature: Uint8Array,
): Uint8Array =>
  packet(
    SIGNATURE_TAG,
    concatBytes(
      hashedPart(params),
      subpacketArea([subpacket(SUBPACKET.issuerKeyId, params.fingerprint.subarray(12))]),
      digest.subarray(0, 2),
      mpi(signature.subarray(0, 32)),
      mpi(signature.subarray(32, 64)),
    ),
  );

export const publicKeyPacket = (keyBody: Uint8Array): Uint8Array => packet(PUBLIC_KEY_TAG, keyBody);

export const userIdPacket = (userId: string): Uint8Array =>
  packet(USER_ID_TAG, new TextEncoder().encode(userId));

export const armor = (kind: "PUBLIC KEY BLOCK" | "SIGNATURE", bytes: Uint8Array): string =>
  [
    `-----BEGIN PGP ${kind}-----`,
    "",
    // No CRC-24 line: RFC 9580 makes it optional, and gpgv and sqv verify without it.
    ...(toBase64(bytes).match(/.{1,64}/gu) ?? []),
    `-----END PGP ${kind}-----`,
    "",
  ].join("\n");

const cleartextLines = (text: string): readonly string[] => text.replace(/\n$/u, "").split("\n");

/**
 * The bytes a canonical-text signature over `text` covers: each line without
 * trailing whitespace, CRLF between lines. The line break before the armor
 * that follows a cleartext message is not part of it.
 */
export const canonicalText = (text: string): Uint8Array =>
  new TextEncoder().encode(
    cleartextLines(text)
      .map((line) => line.replace(/[ \t]+$/u, ""))
      .join("\r\n"),
  );

/** A cleartext-signed message (what apt reads as `InRelease`), lines starting `-` dash-escaped. */
export const cleartextMessage = (text: string, signature: Uint8Array): string =>
  [
    "-----BEGIN PGP SIGNED MESSAGE-----",
    "Hash: SHA512",
    "",
    ...cleartextLines(text).map((line) => (line.startsWith("-") ? `- ${line}` : line)),
    armor("SIGNATURE", signature),
  ].join("\n");
