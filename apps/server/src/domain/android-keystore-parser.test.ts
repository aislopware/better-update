import { fromHex } from "@better-update/encoding";
import { Effect } from "effect";

import { validateAndroidKeystore } from "./android-keystore-parser";

const withMagic = (hex: string) => {
  const bytes = new Uint8Array(64);
  bytes.set(fromHex(hex));
  return bytes;
};

describe(validateAndroidKeystore, () => {
  it("detects JKS magic", async () => {
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

  it("detects PKCS12 magic", async () => {
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

  it("normalizes fingerprints", async () => {
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

  it("rejects too-small files", async () => {
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

  it("rejects empty alias", async () => {
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

  it("rejects missing passwords", async () => {
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

  it("rejects unknown magic", async () => {
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
