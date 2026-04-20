import { Effect } from "effect";

import { validateAndroidKeystore } from "./android-keystore-parser";

const withMagic = (hex: string) => {
  const bytes = new Uint8Array(64);
  const magic = hex.match(/.{2}/g) ?? [];
  magic.forEach((byte, index) => {
    bytes[index] = Number.parseInt(byte, 16);
  });
  return bytes;
};

describe(validateAndroidKeystore, () => {
  test("detects JKS magic", async () => {
    const result = await Effect.runPromise(
      validateAndroidKeystore({
        bytes: withMagic("FEEDFEED"),
        keyAlias: "upload",
        keystorePassword: "pass",
        keyPassword: "pass",
      }),
    );
    expect(result.format).toBe("JKS");
  });

  test("detects PKCS12 magic", async () => {
    const result = await Effect.runPromise(
      validateAndroidKeystore({
        bytes: withMagic("3082"),
        keyAlias: "upload",
        keystorePassword: "pass",
        keyPassword: "pass",
      }),
    );
    expect(result.format).toBe("PKCS12");
  });

  test("normalizes fingerprints", async () => {
    const result = await Effect.runPromise(
      validateAndroidKeystore({
        bytes: withMagic("FEEDFEED"),
        keyAlias: "upload",
        keystorePassword: "pass",
        keyPassword: "pass",
        sha256Fingerprint: "ab:cd:ef",
        md5Fingerprint: " ",
        sha1Fingerprint: "bad!",
      }),
    );
    expect(result.sha256Fingerprint).toBe("AB:CD:EF");
    expect(result.md5Fingerprint).toBeNull();
    expect(result.sha1Fingerprint).toBeNull();
  });

  test("rejects too-small files", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        validateAndroidKeystore({
          bytes: new Uint8Array(4),
          keyAlias: "upload",
          keystorePassword: "pass",
          keyPassword: "pass",
        }),
      ),
    );
    expect(error.message).toMatch(/too small/);
  });

  test("rejects empty alias", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        validateAndroidKeystore({
          bytes: withMagic("FEEDFEED"),
          keyAlias: " ",
          keystorePassword: "pass",
          keyPassword: "pass",
        }),
      ),
    );
    expect(error.message).toMatch(/alias/);
  });

  test("rejects missing passwords", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        validateAndroidKeystore({
          bytes: withMagic("FEEDFEED"),
          keyAlias: "upload",
          keystorePassword: "",
          keyPassword: "pass",
        }),
      ),
    );
    expect(error.message).toMatch(/passwords/);
  });

  test("rejects unknown magic", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        validateAndroidKeystore({
          bytes: withMagic("AABBCCDD"),
          keyAlias: "upload",
          keystorePassword: "pass",
          keyPassword: "pass",
        }),
      ),
    );
    expect(error.message).toMatch(/magic/);
  });
});
