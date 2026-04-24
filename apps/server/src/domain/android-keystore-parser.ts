import { fromHex } from "@better-update/encoding";
import { Data, Effect } from "effect";

export class InvalidAndroidKeystore extends Data.TaggedError("InvalidAndroidKeystore")<{
  readonly message: string;
}> {}

const JKS_MAGIC = fromHex("FEEDFEED");
const PKCS12_MAGIC = fromHex("3082");

export type KeystoreFormat = "JKS" | "PKCS12" | "UNKNOWN";

export interface ValidateKeystoreParams {
  readonly bytes: Uint8Array;
  readonly keyAlias: string;
  readonly keystorePassword: string;
  readonly keyPassword: string;
  readonly md5Fingerprint?: string;
  readonly sha1Fingerprint?: string;
  readonly sha256Fingerprint?: string;
}

export interface ValidatedKeystore {
  readonly format: KeystoreFormat;
  readonly keyAlias: string;
  readonly md5Fingerprint: string | null;
  readonly sha1Fingerprint: string | null;
  readonly sha256Fingerprint: string | null;
}

const hasMagic = (bytes: Uint8Array, magic: Uint8Array) => {
  if (bytes.byteLength < magic.byteLength) {
    return false;
  }
  return [...magic].every((byte, index) => bytes[index] === byte);
};

const detectFormat = (bytes: Uint8Array): KeystoreFormat => {
  if (hasMagic(bytes, JKS_MAGIC)) {
    return "JKS";
  }
  if (hasMagic(bytes, PKCS12_MAGIC)) {
    return "PKCS12";
  }
  return "UNKNOWN";
};

const HEX_PATTERN = /^[0-9A-Fa-f:]+$/u;

const normalizeFingerprint = (value: string | undefined) => {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  if (!HEX_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed.toUpperCase();
};

export const validateAndroidKeystore = (params: ValidateKeystoreParams) =>
  Effect.gen(function* () {
    if (params.bytes.byteLength < 16) {
      return yield* Effect.fail(new InvalidAndroidKeystore({ message: "Keystore file too small" }));
    }
    if (params.keyAlias.trim().length === 0) {
      return yield* Effect.fail(new InvalidAndroidKeystore({ message: "Key alias is required" }));
    }
    if (params.keystorePassword.length === 0 || params.keyPassword.length === 0) {
      return yield* Effect.fail(
        new InvalidAndroidKeystore({ message: "Keystore and key passwords are required" }),
      );
    }
    const format = detectFormat(params.bytes);
    if (format === "UNKNOWN") {
      return yield* Effect.fail(
        new InvalidAndroidKeystore({
          message: "Unrecognized keystore magic bytes (expected JKS or PKCS12)",
        }),
      );
    }
    const result: ValidatedKeystore = {
      format,
      keyAlias: params.keyAlias.trim(),
      md5Fingerprint: normalizeFingerprint(params.md5Fingerprint),
      sha1Fingerprint: normalizeFingerprint(params.sha1Fingerprint),
      sha256Fingerprint: normalizeFingerprint(params.sha256Fingerprint),
    };
    return result;
  });
