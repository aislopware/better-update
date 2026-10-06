import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import forge from "node-forge";

import { setupCliE2E } from "../helpers/cli-e2e";

/**
 * The Account Holder hand-off against a real server and vault: `csr create`
 * leaves a key behind and writes a request; a certificate issued for that
 * request (here by a throwaway CA standing in for Apple — the import never
 * validates the chain, codesign does) is paired with the key, sealed into the
 * vault under the platform its common name names, and the key is forgotten.
 */
const cli = setupCliE2E("e2e-cli-csr-handoff", {
  userEmail: "cli-e2e-csr@example.com",
  orgSlug: "cli-e2e-csr-org",
});

const TEAM_ID = "ABCDE12345";
const COMMON_NAME = `Developer ID Application: Example Inc (${TEAM_ID})`;

const expectSuccess = (result: { readonly exitCode: number; readonly stderr: string }) => {
  expect(result.exitCode === 0 ? "" : `exit ${result.exitCode}: ${result.stderr}`).toBe("");
};

/** Issue a DER certificate for the CSR's public key, the way Apple's portal would. */
const issueFor = (csrPem: string, commonName: string): Buffer => {
  const csr = forge.pki.certificationRequestFromPem(csrPem);
  const caKeys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = csr.publicKey!;
  cert.serialNumber = "0a1b2c3d4e5f";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  cert.setSubject([
    { name: "commonName", value: commonName },
    { shortName: "OU", value: TEAM_ID },
    { name: "organizationName", value: "Example Inc" },
    { name: "countryName", value: "US" },
  ]);
  cert.setIssuer([
    { name: "commonName", value: "Developer ID Certification Authority" },
    { shortName: "OU", value: "G2" },
    { name: "organizationName", value: "Example CA" },
  ]);
  cert.sign(caKeys.privateKey, forge.md.sha256.create());
  return Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), "binary");
};

describe("credentials csr — Account Holder hand-off", () => {
  let workRoot = "";
  let csrPath = "";

  beforeAll(async () => {
    workRoot = mkdtempSync(path.join(os.tmpdir(), "csr-e2e-"));
    csrPath = path.join(workRoot, "DeveloperIDApplication.certSigningRequest");
    await cli.bootstrapOrgVault();
    expectSuccess(cli.runCli("init"));
  });

  afterAll(() => {
    rmSync(workRoot, { recursive: true, force: true });
  });

  it("creates a request and keeps the key pending on this machine", () => {
    const result = cli.runCli(
      "credentials",
      "csr",
      "create",
      "--common-name",
      "Jane Example",
      "--email",
      "jane@example.com",
      "--output",
      csrPath,
    );
    expectSuccess(result);
    expect(result.stdout).toContain("G2 Sub-CA");
    expect(result.stdout).toContain("better-update credentials csr import");

    const csr = forge.pki.certificationRequestFromPem(readFileSync(csrPath, "utf8"));
    expect(csr.verify()).toBe(true);
    expect(csr.subject.getField("CN")?.value).toBe("Jane Example");

    const pending = cli.runCli("credentials", "csr", "list", "--json");
    expectSuccess(pending);
    expect(JSON.parse(pending.stdout).data).toStrictEqual([
      expect.objectContaining({
        purpose: "developer-id-application",
        commonName: "Jane Example",
        csrPath,
      }),
    ]);
  });

  it("refuses a certificate no pending request asked for", () => {
    const strangerCsr = forge.pki.createCertificationRequest();
    const keys = forge.pki.rsa.generateKeyPair(2048);
    strangerCsr.publicKey = keys.publicKey;
    strangerCsr.sign(keys.privateKey, forge.md.sha256.create());
    const cerPath = path.join(workRoot, "stranger.cer");
    writeFileSync(cerPath, issueFor(forge.pki.certificationRequestToPem(strangerCsr), COMMON_NAME));

    const result = cli.runCli("credentials", "csr", "import", cerPath);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("No pending request on this machine matches stranger.cer");
  });

  it("pairs the issued certificate with its key and stores it as a macOS certificate", () => {
    const cerPath = path.join(workRoot, "developerID_application.cer");
    writeFileSync(cerPath, issueFor(readFileSync(csrPath, "utf8"), COMMON_NAME));

    const result = cli.runCli("credentials", "csr", "import", cerPath, "--json");
    expectSuccess(result);
    expect(JSON.parse(result.stdout).data).toMatchObject({
      Certificate: COMMON_NAME,
      Platform: "macos",
      Type: "macos-certificate",
    });

    const listed = cli.runCli("credentials", "list", "--platform", "macos", "--json");
    expectSuccess(listed);
    expect(JSON.parse(listed.stdout).data.items).toStrictEqual([
      expect.objectContaining({
        Platform: "macos",
        Type: "macos-certificate",
        "Cert type": "Developer ID Application",
      }),
    ]);

    // The key is gone once sealed into the vault.
    const pending = cli.runCli("credentials", "csr", "list", "--json");
    expectSuccess(pending);
    expect(JSON.parse(pending.stdout).data).toStrictEqual([]);
  });
});
