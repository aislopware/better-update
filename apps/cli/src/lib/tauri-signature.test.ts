import {
  minisignScryptParams,
  parseTauriPrivateKey,
  parseTauriPublicKey,
  signTauriArchive,
  tauriKeysMatch,
  tauriPublicKeyText,
  verifyTauriSignature,
} from "./tauri-signature";

// A throwaway key pair from `tauri signer generate -p test-pass` (tauri-cli
// 2.12.1), and its `tauri signer sign` signature of FIXTURE_BYTES.
const PRIVATE_KEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IHJzaWduIGVuY3J5cHRlZCBzZWNyZXQga2V5ClJXUlRZMEl5UXd1Z2UxTWcyclNTWWpxTW5Wb0hWRW5wcnZHY0hJS0thNnVXUDZ5elNSb0FBQkFBQUFBQUFBQUFBQUlBQUFBQTlOY3BBRXdtNitTWS8vR3c3VmwxL3prYW5HWnBwVGt6d21WaUlZTm1CYS84cjFSRklBRlJRVkd3aUxZTTFyMUtwNE54M0RwbElUZENibmE0UEJ6S1lqcjZFc0RIdlBCVUppd0lXcjVmRGp1RzJNMmhsOE1lK1ZiZ0dWTlV6R0Mrc2VaMUI5Ym1ib0E9Cg==";
const PASSWORD = "test-pass";
const PUBLIC_KEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEE1NzMxMjNDMDkwMzBDMTcKUldRWERBTUpQQkp6cFMvaVVlR1VIbjFzcEx1TjVjcFdValhVWURWVHJFclpsMk9qV1RKT0VzVlIK";
const TAURI_SIGNATURE =
  "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRWERBTUpQQkp6cFRwZGtIZVRKTWVvN2pOZ1VoNk82Ry9ieEV2RDlaeFBqNEUwK3BacFE0RHIwSHYxVmNwVUpLbUdzS2xrSmNHb2pqc0xKTmhwS01obHhHOExDNnlQV1FJPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkxMjcyMDQ1CWZpbGU6c21hbGwuYmluCnJnMkdOSitjS0RmamRZSFUycldvRlhMaW5MaXVyRXd3NldJTDczYjNLK3NCS09VeWhSS1p3T0FlaW1UemRZVUpISlhteWMrVThYZmptS1IyalpsbkJBPT0K";
const FIXTURE_BYTES = new TextEncoder().encode("better-update tauri fixture");

const privateKey = () => {
  const key = parseTauriPrivateKey(PRIVATE_KEY, PASSWORD);
  if (typeof key === "string") {
    throw new TypeError(key);
  }
  return key;
};

const publicKey = () => {
  const key = parseTauriPublicKey(PUBLIC_KEY);
  if (key === undefined) {
    throw new TypeError("fixture public key did not parse");
  }
  return key;
};

describe(minisignScryptParams, () => {
  it("derives minisign's default scrypt cost (N = 2^15, r = 8, p = 1)", () => {
    expect(minisignScryptParams(1_048_576, 33_554_432)).toStrictEqual({
      nLog2: 15,
      blockSize: 8,
      parallelism: 1,
    });
  });
});

describe(parseTauriPrivateKey, () => {
  it("decrypts the key tauri-cli generated and derives its public key", () => {
    const key = privateKey();
    expect(tauriKeysMatch(key, publicKey())).toBe(true);
    expect(tauriPublicKeyText(key)).toBe(PUBLIC_KEY);
  });

  it("accepts the box text as well as its base64", () => {
    const boxText = Buffer.from(PRIVATE_KEY, "base64").toString("utf8");
    expect(parseTauriPrivateKey(boxText, PASSWORD)).toStrictEqual(privateKey());
  });

  it("names a wrong password", () => {
    expect(parseTauriPrivateKey(PRIVATE_KEY, "nope")).toMatch(/Wrong password/u);
  });

  it("refuses something that is not a minisign secret key", () => {
    expect(parseTauriPrivateKey(PUBLIC_KEY, PASSWORD)).toMatch(/Not a Tauri updater private key/u);
    expect(parseTauriPrivateKey("not base64 at all", PASSWORD)).toMatch(/Not a Tauri/u);
  });
});

describe(verifyTauriSignature, () => {
  it("accepts tauri-cli's own signature", () => {
    expect(verifyTauriSignature(publicKey(), FIXTURE_BYTES, TAURI_SIGNATURE)).toStrictEqual({
      valid: true,
      signedVersion: undefined,
    });
  });

  it("rejects other bytes", () => {
    const tampered = new TextEncoder().encode("better-update tauri fixturE");
    expect(verifyTauriSignature(publicKey(), tampered, TAURI_SIGNATURE).valid).toBe(false);
  });
});

describe(signTauriArchive, () => {
  it("signs what the updater verifies, binding the version in the trusted comment", () => {
    const signature = signTauriArchive(privateKey(), FIXTURE_BYTES, {
      fileName: "Example.app.tar.gz",
      version: "1.2.3",
      timestamp: 1_790_000_000,
    });
    expect(verifyTauriSignature(publicKey(), FIXTURE_BYTES, signature)).toStrictEqual({
      valid: true,
      signedVersion: "1.2.3",
    });
    expect(Buffer.from(signature, "base64").toString("utf8")).toContain(
      "trusted comment: timestamp:1790000000\tfile:Example.app.tar.gz\tversion:1.2.3\n",
    );
  });

  it("cannot be re-pointed at another version: the trusted comment is signed", () => {
    const signature = signTauriArchive(privateKey(), FIXTURE_BYTES, {
      fileName: "Example.app.tar.gz",
      version: "1.2.3",
      timestamp: 1_790_000_000,
    });
    const forged = Buffer.from(
      Buffer.from(signature, "base64").toString("utf8").replace("version:1.2.3", "version:9.9.9"),
    ).toString("base64");
    expect(verifyTauriSignature(publicKey(), FIXTURE_BYTES, forged).valid).toBe(false);
  });
});
