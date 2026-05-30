import { createVerify, generateKeyPairSync, X509Certificate } from "node:crypto";

import { buildRollbackDirectiveBody } from "@better-update/expo-protocol";
import { Effect } from "effect";
import forge from "node-forge";

import type { ManifestAssetData, ManifestUpdateData } from "@better-update/expo-protocol";

import { renderManifest, signBody, signDirectiveBody } from "./manifest-signing";

// Generate a 2048-bit RSA keypair + a self-signed code-signing certificate so
// the sign-then-verify round-trip uses real crypto end to end (the way the
// device verifies). node:crypto produces the PEM private key; node-forge builds
// the self-signed cert around the matching public key.
const makeKeypairAndCert = (): {
  readonly privateKeyPem: string;
  readonly certificatePem: string;
} => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ type: "pkcs1", format: "pem" });
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });

  const forgePrivateKey = forge.pki.privateKeyFromPem(privateKeyPem);
  const forgePublicKey = forge.pki.publicKeyFromPem(publicKeyPem);

  const cert = forge.pki.createCertificate();
  cert.publicKey = forgePublicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  const attrs = [{ name: "commonName", value: "Better Update Code Signing" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "keyUsage", digitalSignature: true, keyCertSign: true },
    { name: "basicConstraints", cA: true },
    { name: "extKeyUsage", codeSigning: true },
  ]);
  cert.sign(forgePrivateKey, forge.md.sha256.create());

  return {
    privateKeyPem,
    certificatePem: forge.pki.certificateToPem(cert),
  };
};

const update: ManifestUpdateData = {
  id: "01890c4a-0000-7000-8000-000000000001",
  createdAt: "2025-01-01T00:00:00.000Z",
  runtimeVersion: "1.0.0",
  metadata: {},
  extra: { expoClient: { name: "round-trip-app" } },
};

const launchAsset: ManifestAssetData = {
  key: "bundle",
  hash: "launchhash",
  contentChecksum: "launch-raw",
  contentType: "application/javascript",
  fileExt: "js",
  isLaunch: true,
};

const imageAsset: ManifestAssetData = {
  key: "assets/logo",
  hash: "imagehash",
  contentChecksum: "image-raw",
  contentType: "image/png",
  fileExt: "png",
  isLaunch: false,
};

const SERVER_BASE_URL = "https://api.example.dev";
const ASSET_CDN_URL = "https://cdn.example.com";
const PROJECT_ID = "proj_round_trip";

describe(renderManifest, () => {
  it("emits launchAsset.url pointing at the Worker bundle route (Gap-D fix)", () => {
    const body = renderManifest({
      update,
      assets: [launchAsset],
      assetBaseUrl: ASSET_CDN_URL,
      serverBaseUrl: SERVER_BASE_URL,
      projectId: PROJECT_ID,
    });
    const parsed = JSON.parse(body) as { launchAsset: { url: string } };
    expect(parsed.launchAsset.url).toBe(
      `${SERVER_BASE_URL}/manifest/${PROJECT_ID}/bundle/${update.id}/${launchAsset.hash}`,
    );
  });

  it("routes non-launch assets to the CDN origin, NOT the API origin", () => {
    // The deployed Worker has no `/assets/{hash}` route on the API origin; the
    // signed body is served verbatim, so a regular asset whose URL pointed at
    // the API origin would 404 on-device. Regular asset URLs must use the CDN
    // base while the launch bundle stays on the Worker bundle route.
    const body = renderManifest({
      update,
      assets: [launchAsset, imageAsset],
      assetBaseUrl: ASSET_CDN_URL,
      serverBaseUrl: SERVER_BASE_URL,
      projectId: PROJECT_ID,
    });
    const parsed = JSON.parse(body) as {
      launchAsset: { url: string };
      assets: readonly { url: string }[];
    };
    expect(parsed.assets).toHaveLength(1);
    expect(parsed.assets[0]?.url).toBe(`${ASSET_CDN_URL}/assets/${imageAsset.hash}`);
    expect(parsed.assets[0]?.url.startsWith(SERVER_BASE_URL)).toBe(false);
    // The launch bundle still negotiates bsdiff via the Worker route.
    expect(parsed.launchAsset.url).toBe(
      `${SERVER_BASE_URL}/manifest/${PROJECT_ID}/bundle/${update.id}/${launchAsset.hash}`,
    );
  });
});

describe(signBody, () => {
  it("signs a body that verifies with the cert public key (device-style round-trip)", async () => {
    const { privateKeyPem, certificatePem } = makeKeypairAndCert();
    const body = renderManifest({
      update,
      assets: [launchAsset],
      assetBaseUrl: "https://cdn.example.com",
      serverBaseUrl: SERVER_BASE_URL,
      projectId: PROJECT_ID,
    });

    const { signature } = await Effect.runPromise(
      signBody({ bodyBytes: body, privateKeyPem, certificatePem, keyid: "main" }),
    );

    // Full SFV header shape.
    const sigMatch = /^sig="([^"]+)", keyid="main", alg="rsa-v1_5-sha256"$/.exec(signature);
    expect(sigMatch).not.toBeNull();
    const sig = sigMatch![1]!;

    // Verify exactly the way the device does: RSA-SHA256 over the UTF-8 body
    // bytes against the certificate's public key.
    const certPublicKey = new X509Certificate(certificatePem).publicKey;
    const verified = createVerify("RSA-SHA256")
      .update(body, "utf8")
      .verify(certPublicKey, sig, "base64");
    expect(verified).toBe(true);
  });

  it("fails when the private key does not match the certificate (self-verify guard)", async () => {
    const signer = makeKeypairAndCert();
    const other = makeKeypairAndCert();
    const body = renderManifest({
      update,
      assets: [launchAsset],
      assetBaseUrl: "https://cdn.example.com",
      serverBaseUrl: SERVER_BASE_URL,
      projectId: PROJECT_ID,
    });

    const result = await Effect.runPromise(
      Effect.either(
        // Sign with one key but hand a DIFFERENT cert → self-verify must fail.
        signBody({
          bodyBytes: body,
          privateKeyPem: signer.privateKeyPem,
          certificatePem: other.certificatePem,
          keyid: "main",
        }),
      ),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("UpdatePublishError");
    }
  });

  it("signs the EXACT render output with no re-stringify between render and sign", async () => {
    const { privateKeyPem, certificatePem } = makeKeypairAndCert();
    const body = renderManifest({
      update,
      assets: [launchAsset],
      assetBaseUrl: "https://cdn.example.com",
      serverBaseUrl: SERVER_BASE_URL,
      projectId: PROJECT_ID,
    });

    const { signature } = await Effect.runPromise(
      signBody({ bodyBytes: body, privateKeyPem, certificatePem, keyid: "main" }),
    );
    const sig = /^sig="([^"]+)"/.exec(signature)![1]!;

    // The same string is the signed input AND what callers send as manifestBody.
    // Verifying over `body` (not a re-rendered copy) proves byte-identity.
    const certPublicKey = new X509Certificate(certificatePem).publicKey;
    expect(
      createVerify("RSA-SHA256").update(body, "utf8").verify(certPublicKey, sig, "base64"),
    ).toBe(true);
  });
});

describe(signDirectiveBody, () => {
  const COMMIT_TIME = "2026-04-15T00:00:00.000Z";

  it("signs a rollback directive that verifies with the cert public key (device-style round-trip)", async () => {
    const { privateKeyPem, certificatePem } = makeKeypairAndCert();
    const directiveBody = buildRollbackDirectiveBody(COMMIT_TIME);

    const { signature } = await Effect.runPromise(
      signDirectiveBody({ bodyBytes: directiveBody, privateKeyPem, certificatePem, keyid: "main" }),
    );

    // Same `expo-signature` SFV shape the device parses for a directive part.
    const sigMatch = /^sig="([^"]+)", keyid="main", alg="rsa-v1_5-sha256"$/.exec(signature);
    expect(sigMatch).not.toBeNull();
    const sig = sigMatch![1]!;

    // The device runs the SAME RSA-SHA256 `validateSignature` over a directive
    // part body as over a manifest part — verify exactly that way over the EXACT
    // signed bytes (no re-stringify between build and sign).
    const certPublicKey = new X509Certificate(certificatePem).publicKey;
    const verified = createVerify("RSA-SHA256")
      .update(directiveBody, "utf8")
      .verify(certPublicKey, sig, "base64");
    expect(verified).toBe(true);
  });

  it("fails with UpdateRollbackError when the private key does not match the certificate", async () => {
    const signer = makeKeypairAndCert();
    const other = makeKeypairAndCert();
    const directiveBody = buildRollbackDirectiveBody(COMMIT_TIME);

    const result = await Effect.runPromise(
      Effect.either(
        // Sign with one key but hand a DIFFERENT cert → self-verify must fail,
        // and the failure must carry the rollback error tag (not the publish one).
        signDirectiveBody({
          bodyBytes: directiveBody,
          privateKeyPem: signer.privateKeyPem,
          certificatePem: other.certificatePem,
          keyid: "main",
        }),
      ),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("UpdateRollbackError");
    }
  });
});
