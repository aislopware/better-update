import { pemToPkcs8Der } from "./apple-pem";

const VALID_PEM = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgqIOEeXH1hSPYy+1c
-----END PRIVATE KEY-----`;

describe(pemToPkcs8Der, () => {
  test("returns bytes for a valid PEM body", () => {
    const der = pemToPkcs8Der(VALID_PEM);
    expect(der).not.toBeNull();
    expect(der?.byteLength).toBeGreaterThan(0);
  });

  test("tolerates Windows line endings", () => {
    const crlf = VALID_PEM.replaceAll("\n", "\r\n");
    expect(pemToPkcs8Der(crlf)).not.toBeNull();
  });

  test("returns null for missing header", () => {
    expect(pemToPkcs8Der("not a pem")).toBeNull();
  });

  test("returns null for empty body", () => {
    expect(pemToPkcs8Der("-----BEGIN PRIVATE KEY-----\n\n-----END PRIVATE KEY-----")).toBeNull();
  });
});
