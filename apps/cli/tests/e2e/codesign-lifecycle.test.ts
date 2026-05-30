import { createVerify, X509Certificate } from "node:crypto";
import { writeFileSync, rmSync } from "node:fs";
import path from "node:path";

import {
  TEST_CODE_SIGNING_CERTIFICATE_PEM,
  TEST_CODE_SIGNING_PRIVATE_KEY_PEM,
} from "../../../server/tests/helpers/code-signing-fixture";
import { setupCliE2E } from "../helpers/cli-e2e";

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../../fixtures/e2e-app");

const CERT_FILENAME = "code-signing-certificate.pem";
const KEY_FILENAME = "code-signing-private-key.pem";

// app.json points expo-updates code signing at the cert we drop into the
// project dir below; the matching private key is handed to `--private-key-path`
// so the CLI signs the rendered manifest / rollback directive in-process.
const codesignAppJsonTemplate = {
  expo: {
    name: "Codesign Lifecycle App",
    slug: "codesign-lifecycle-app",
    owner: "codesign-lifecycle",
    version: "1.0.0",
    runtimeVersion: "1.0.0",
    updates: {
      codeSigningCertificate: `./${CERT_FILENAME}`,
      codeSigningMetadata: { keyid: "main", alg: "rsa-v1_5-sha256" },
    },
    ios: {
      bundleIdentifier: "com.example.codesign",
      buildNumber: "1",
    },
    android: {
      package: "com.example.codesign",
      versionCode: 1,
    },
    extra: {
      betterUpdate: {
        profiles: {
          production: {
            environment: "production",
            ios: { distribution: "ad-hoc" },
            android: { distribution: "direct", format: "apk" },
          },
        },
      },
    },
  },
};

const cli = setupCliE2E("e2e-cli-codesign", {
  projectDir: FIXTURE_DIR,
  appJsonTemplate: codesignAppJsonTemplate,
  userEmail: "cli-e2e-codesign@example.com",
  orgSlug: "cli-e2e-codesign-org",
});

// ── Helpers ──────────────────────────────────────────────────────

interface MultipartPart {
  readonly headers: Record<string, string>;
  readonly body: string;
}

const parseMultipart = (contentType: string, rawBody: string): readonly MultipartPart[] => {
  const boundary = /boundary=([^\s;]+)/.exec(contentType)?.[1] ?? "";
  return rawBody
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((part) => {
      const [headerSection = "", ...bodySections] = part.split("\r\n\r\n");
      const headers = Object.fromEntries(
        headerSection
          .split("\r\n")
          .filter(Boolean)
          .map((line) => {
            const idx = line.indexOf(": ");
            return [line.slice(0, idx).toLowerCase(), line.slice(idx + 2)];
          }),
      );
      return { headers, body: bodySections.join("\r\n\r\n").replace(/\r\n$/, "") };
    });
};

const findPart = (parts: readonly MultipartPart[], name: string) =>
  parts.find((part) => part.headers["content-disposition"]?.includes(`name="${name}"`));

// Verify exactly the way an expo-updates client does: parse the per-part
// `expo-signature` SFV header, then RSASSA-PKCS1-v1_5 + SHA-256 over the EXACT
// part body bytes against the configured certificate's public key.
const verifyExpoSignature = (sfvHeader: string | undefined, body: string): boolean => {
  if (sfvHeader === undefined) {
    return false;
  }
  const match = /^sig="([^"]+)", keyid="main", alg="rsa-v1_5-sha256"$/.exec(sfvHeader);
  if (match === null) {
    return false;
  }
  const certPublicKey = new X509Certificate(TEST_CODE_SIGNING_CERTIFICATE_PEM).publicKey;
  return createVerify("RSA-SHA256").update(body, "utf8").verify(certPublicKey, match[1]!, "base64");
};

// A code-signing client always sends `expo-expect-signature`; its presence is
// what makes the server attach the stored signature + certificate_chain.
const signedManifestHeaders = (overrides?: Record<string, string>) => ({
  "expo-protocol-version": "1",
  "expo-platform": "ios",
  "expo-runtime-version": "1.0.0",
  "expo-channel-name": "main",
  "expo-expect-signature": "true",
  accept: "multipart/mixed",
  ...overrides,
});

// ── Tests ────────────────────────────────────────────────────────

describe("code-signing lifecycle: CLI auto-sign publish + rollback (device-style verify)", () => {
  beforeAll(() => {
    const projectDir = cli.getProjectDir();
    writeFileSync(path.join(projectDir, CERT_FILENAME), TEST_CODE_SIGNING_CERTIFICATE_PEM);
    writeFileSync(path.join(projectDir, KEY_FILENAME), TEST_CODE_SIGNING_PRIVATE_KEY_PEM);
  });

  afterAll(() => {
    const projectDir = cli.getProjectDir();
    rmSync(path.join(projectDir, CERT_FILENAME), { force: true });
    rmSync(path.join(projectDir, KEY_FILENAME), { force: true });
  });

  it("links the fixture app to the seeded project", () => {
    const result = cli.runCli("init");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Project linked successfully");
  });

  it("auto-signs a published manifest the device can verify", async () => {
    const keyPath = path.join(cli.getProjectDir(), KEY_FILENAME);
    const result = cli.runCli(
      "update",
      "publish",
      "--branch",
      "main",
      "--platform",
      "ios",
      "--private-key-path",
      keyPath,
      "--allow-dirty",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Published update group");

    const response = await cli.get(`/manifest/${cli.getProjectId()}`, signedManifestHeaders());
    expect(response.status).toBe(200);
    const parts = parseMultipart(response.headers.get("content-type") ?? "", await response.text());

    const manifestPart = findPart(parts, "manifest");
    expect(manifestPart).toBeDefined();
    // The signed manifest body verifies against the configured cert.
    expect(verifyExpoSignature(manifestPart!.headers["expo-signature"], manifestPart!.body)).toBe(
      true,
    );
    // The certificate chain travels with the signed response.
    const certPart = findPart(parts, "certificate_chain");
    expect(certPart).toBeDefined();
    expect(certPart!.body).toContain("BEGIN CERTIFICATE");
  });

  it("auto-signs a rollback directive the device can verify", async () => {
    const keyPath = path.join(cli.getProjectDir(), KEY_FILENAME);
    const result = cli.runCli(
      "update",
      "rollback",
      "--branch",
      "main",
      "--platform",
      "ios",
      "--private-key-path",
      keyPath,
      "--commit-time",
      "2026-04-15T00:00:00.000Z",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Created rollback group");

    const response = await cli.get(`/manifest/${cli.getProjectId()}`, signedManifestHeaders());
    expect(response.status).toBe(200);
    const parts = parseMultipart(response.headers.get("content-type") ?? "", await response.text());

    const directivePart = findPart(parts, "directive");
    expect(directivePart).toBeDefined();
    // The served directive is the rollBackToEmbedded body we signed…
    expect(JSON.parse(directivePart!.body)).toStrictEqual({
      type: "rollBackToEmbedded",
      parameters: { commitTime: "2026-04-15T00:00:00.000Z" },
    });
    // …and its signature verifies device-style against the configured cert.
    expect(verifyExpoSignature(directivePart!.headers["expo-signature"], directivePart!.body)).toBe(
      true,
    );
    const certPart = findPart(parts, "certificate_chain");
    expect(certPart).toBeDefined();
    expect(certPart!.body).toContain("BEGIN CERTIFICATE");

    // A rollback response carries only the directive — no manifest part.
    expect(findPart(parts, "manifest")).toBeUndefined();
  });
});
