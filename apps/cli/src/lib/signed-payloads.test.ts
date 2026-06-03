import { createVerify, generateKeyPairSync, X509Certificate } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import forge from "node-forge";

import type { ManifestAssetData, ManifestUpdateData } from "@better-update/expo-protocol";

import { UpdatePublishError } from "./exit-codes";
import {
  assertSignedManifestBundleUrl,
  buildSignedPayloadFromRender,
  loadOptionalSignedPayload,
  loadSignedPublishPayloads,
} from "./signed-payloads";
import { failureError } from "./test-utils";

const withSignedFiles = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "signed-payloads-"));
  const manifestPath = path.join(dir, "manifest.json");
  const signaturePath = path.join(dir, "manifest.sig");
  const certificatePath = path.join(dir, "manifest.pem");

  writeFileSync(manifestPath, '{"runtimeVersion":"1.0.0"}\n');
  writeFileSync(signaturePath, 'sig="test-signature"\n');
  writeFileSync(certificatePath, "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n");

  return {
    manifestPath,
    signaturePath,
    certificatePath,
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
};

describe(loadOptionalSignedPayload, () => {
  it.effect("loads a complete signed payload triplet", () =>
    Effect.gen(function* () {
      const files = withSignedFiles();
      const payload = yield* loadOptionalSignedPayload({
        files: {
          manifestBodyFile: files.manifestPath,
          signatureFile: files.signaturePath,
          certificateChainFile: files.certificatePath,
        },
        label: "Signed promote",
        makeError: (message) => new UpdatePublishError({ message }),
      }).pipe(Effect.provide(NodeFileSystem.layer), Effect.ensuring(Effect.sync(files.dispose)));

      expect(payload).toStrictEqual({
        manifestBody: '{"runtimeVersion":"1.0.0"}\n',
        signature: 'sig="test-signature"',
        certificateChain: "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----",
      });
    }),
  );
});

describe(loadSignedPublishPayloads, () => {
  it.effect("loads platform-specific signed payloads for a single-platform publish", () =>
    Effect.gen(function* () {
      const iosFiles = withSignedFiles();
      const payloads = yield* loadSignedPublishPayloads({
        platforms: ["ios"],
        globalFiles: {
          manifestBodyFile: undefined,
          signatureFile: undefined,
          certificateChainFile: undefined,
        },
        platformFiles: {
          ios: {
            manifestBodyFile: iosFiles.manifestPath,
            signatureFile: iosFiles.signaturePath,
            certificateChainFile: iosFiles.certificatePath,
          },
        },
        makeError: (message) => new UpdatePublishError({ message }),
      }).pipe(Effect.provide(NodeFileSystem.layer), Effect.ensuring(Effect.sync(iosFiles.dispose)));

      expect(payloads.ios?.manifestBody).toBe('{"runtimeVersion":"1.0.0"}\n');
      expect(payloads.android).toBeUndefined();
    }),
  );

  it.effect("loads per-platform signed payloads for a multi-platform publish", () =>
    Effect.gen(function* () {
      const iosFiles = withSignedFiles();
      const androidFiles = withSignedFiles();
      const payloads = yield* loadSignedPublishPayloads({
        platforms: ["ios", "android"],
        globalFiles: {
          manifestBodyFile: undefined,
          signatureFile: undefined,
          certificateChainFile: undefined,
        },
        platformFiles: {
          ios: {
            manifestBodyFile: iosFiles.manifestPath,
            signatureFile: iosFiles.signaturePath,
            certificateChainFile: iosFiles.certificatePath,
          },
          android: {
            manifestBodyFile: androidFiles.manifestPath,
            signatureFile: androidFiles.signaturePath,
            certificateChainFile: androidFiles.certificatePath,
          },
        },
        makeError: (message) => new UpdatePublishError({ message }),
      }).pipe(
        Effect.provide(NodeFileSystem.layer),
        Effect.ensuring(
          Effect.sync(() => {
            iosFiles.dispose();
            androidFiles.dispose();
          }),
        ),
      );

      expect(payloads.ios?.signature).toBe('sig="test-signature"');
      expect(payloads.android?.certificateChain).toContain("BEGIN CERTIFICATE");
    }),
  );

  it.effect("rejects generic signed files for multi-platform publish", () =>
    Effect.gen(function* () {
      const files = withSignedFiles();
      const exit = yield* loadSignedPublishPayloads({
        platforms: ["ios", "android"],
        globalFiles: {
          manifestBodyFile: files.manifestPath,
          signatureFile: files.signaturePath,
          certificateChainFile: files.certificatePath,
        },
        platformFiles: {},
        makeError: (message) => new UpdatePublishError({ message }),
      }).pipe(
        Effect.provide(NodeFileSystem.layer),
        Effect.ensuring(Effect.sync(files.dispose)),
        Effect.exit,
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error?._tag).toBe("UpdatePublishError");
        expect(error?.message).toBe(
          "Signed multi-platform publish requires per-platform file sets. Use the --*-ios and --*-android options.",
        );
      }
    }),
  );

  it.effect("rejects ambiguous generic and platform-specific files for the same platform", () =>
    Effect.gen(function* () {
      const files = withSignedFiles();
      const exit = yield* loadSignedPublishPayloads({
        platforms: ["ios"],
        globalFiles: {
          manifestBodyFile: files.manifestPath,
          signatureFile: files.signaturePath,
          certificateChainFile: files.certificatePath,
        },
        platformFiles: {
          ios: {
            manifestBodyFile: files.manifestPath,
            signatureFile: files.signaturePath,
            certificateChainFile: files.certificatePath,
          },
        },
        makeError: (message) => new UpdatePublishError({ message }),
      }).pipe(
        Effect.provide(NodeFileSystem.layer),
        Effect.ensuring(Effect.sync(files.dispose)),
        Effect.exit,
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error?._tag).toBe("UpdatePublishError");
        expect(error?.message).toBe(
          "Signed publish for ios is ambiguous. Use either the generic file options or the ios-specific file options, not both.",
        );
      }
    }),
  );
});

// 2048-bit RSA keypair + self-signed code-signing cert so the render+sign
// producer is exercised with real crypto end to end (the way the device
// verifies). node:crypto emits the PEM private key; node-forge wraps the
// matching public key in a self-signed cert.
const makeKeypairAndCert = (): {
  readonly privateKeyPem: string;
  readonly certificatePem: string;
} => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ type: "pkcs1", format: "pem" });
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });

  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKeyPem);
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
  cert.sign(forge.pki.privateKeyFromPem(privateKeyPem), forge.md.sha256.create());

  return { privateKeyPem, certificatePem: forge.pki.certificateToPem(cert) };
};

const RENDER_UPDATE: ManifestUpdateData = {
  id: "01890c4a-0000-7000-8000-0000000000aa",
  createdAt: "2025-01-01T00:00:00.000Z",
  runtimeVersion: "1.0.0",
  metadata: {},
  extra: { expoClient: { name: "render-app" } },
};

const RENDER_LAUNCH_ASSET: ManifestAssetData = {
  key: "bundle",
  hash: "launch-namespaced-hash",
  contentChecksum: "launch-content-checksum",
  contentType: "application/javascript",
  fileExt: "js",
  isLaunch: true,
};

const RENDER_SERVER_BASE_URL = "https://api.example.dev";
const RENDER_PROJECT_ID = "proj_render_sign";

describe(buildSignedPayloadFromRender, () => {
  it.effect(
    "renders a manifestBody whose launchAsset.url is the Worker bundle route and whose signature verifies",
    () =>
      Effect.gen(function* () {
        const { privateKeyPem, certificatePem } = makeKeypairAndCert();

        const payload = yield* buildSignedPayloadFromRender({
          update: RENDER_UPDATE,
          assets: [RENDER_LAUNCH_ASSET],
          assetBaseUrl: RENDER_SERVER_BASE_URL,
          serverBaseUrl: RENDER_SERVER_BASE_URL,
          projectId: RENDER_PROJECT_ID,
          codeSigning: { privateKeyPem, certificateChainPem: certificatePem, keyid: "main" },
        });

        // launchAsset.url is the Worker bundle route (Gap-D fix) — so signed
        // updates negotiate bsdiff just like unsigned ones.
        const parsed = JSON.parse(payload.manifestBody) as {
          id: string;
          launchAsset: { url: string };
        };
        expect(parsed.id).toBe(RENDER_UPDATE.id);
        expect(parsed.launchAsset.url).toBe(
          `${RENDER_SERVER_BASE_URL}/manifest/${RENDER_PROJECT_ID}/bundle/${RENDER_UPDATE.id}/${RENDER_LAUNCH_ASSET.hash}`,
        );

        // The signature is the full expo-signature SFV string.
        const sigMatch = /^sig="(?<sig>[^"]+)", keyid="main", alg="rsa-v1_5-sha256"$/.exec(
          payload.signature,
        );
        expect(sigMatch).not.toBeNull();
        const sig = sigMatch![1]!;

        // Verify the way the device does: RSA-SHA256 over the UTF-8 bytes of the
        // exact manifestBody string against the certificate's public key.
        const certPublicKey = new X509Certificate(payload.certificateChain).publicKey;
        expect(
          createVerify("RSA-SHA256")
            .update(payload.manifestBody, "utf8")
            .verify(certPublicKey, sig, "base64"),
        ).toBe(true);

        // The producer returns the chain it was handed verbatim.
        expect(payload.certificateChain).toBe(certificatePem);
      }),
  );

  it.effect("signs the EXACT bytes it returns (signed bytes === sent bytes)", () =>
    Effect.gen(function* () {
      const { privateKeyPem, certificatePem } = makeKeypairAndCert();

      const payload = yield* buildSignedPayloadFromRender({
        update: RENDER_UPDATE,
        assets: [RENDER_LAUNCH_ASSET],
        assetBaseUrl: RENDER_SERVER_BASE_URL,
        serverBaseUrl: RENDER_SERVER_BASE_URL,
        projectId: RENDER_PROJECT_ID,
        codeSigning: { privateKeyPem, certificateChainPem: certificatePem, keyid: "main" },
      });

      const sig = /^sig="(?<sig>[^"]+)"/.exec(payload.signature)![1]!;
      const certPublicKey = new X509Certificate(payload.certificateChain).publicKey;

      // Byte-identity: the signature verifies over payload.manifestBody (the
      // value sent to api.updates.create) — there is no re-stringify between the
      // signed input and the returned body, so signed bytes === sent bytes.
      expect(
        createVerify("RSA-SHA256")
          .update(payload.manifestBody, "utf8")
          .verify(certPublicKey, sig, "base64"),
      ).toBe(true);

      // Mutating a single byte of the returned body breaks verification, proving
      // the signature is bound to the EXACT bytes that ship.
      const tampered = `${payload.manifestBody} `;
      expect(
        createVerify("RSA-SHA256").update(tampered, "utf8").verify(certPublicKey, sig, "base64"),
      ).toBe(false);
    }),
  );

  it.effect(
    "produces a manifestBody that passes the Gap-D bundle-url assert (both paths share one shape)",
    () =>
      Effect.gen(function* () {
        const { privateKeyPem, certificatePem } = makeKeypairAndCert();

        const payload = yield* buildSignedPayloadFromRender({
          update: RENDER_UPDATE,
          assets: [RENDER_LAUNCH_ASSET],
          assetBaseUrl: RENDER_SERVER_BASE_URL,
          serverBaseUrl: RENDER_SERVER_BASE_URL,
          projectId: RENDER_PROJECT_ID,
          codeSigning: { privateKeyPem, certificateChainPem: certificatePem, keyid: "main" },
        });

        // The render path passes assertSignedManifestBundleUrl trivially — the
        // same guard the file escape-hatch must pass — keeping both routes on one
        // verified shape.
        yield* assertSignedManifestBundleUrl({
          manifestBody: payload.manifestBody,
          serverBaseUrl: RENDER_SERVER_BASE_URL,
          projectId: RENDER_PROJECT_ID,
          platform: "ios",
          makeError: (message) => new UpdatePublishError({ message }),
        });
      }),
  );

  it.effect("fails when the private key does not match the certificate (self-verify guard)", () =>
    Effect.gen(function* () {
      const signer = makeKeypairAndCert();
      const other = makeKeypairAndCert();

      const exit = yield* buildSignedPayloadFromRender({
        update: RENDER_UPDATE,
        assets: [RENDER_LAUNCH_ASSET],
        assetBaseUrl: RENDER_SERVER_BASE_URL,
        serverBaseUrl: RENDER_SERVER_BASE_URL,
        projectId: RENDER_PROJECT_ID,
        // Sign with one key but hand a DIFFERENT cert → self-verify must fail
        // locally rather than publishing a permanently-unverifiable update.
        codeSigning: {
          privateKeyPem: signer.privateKeyPem,
          certificateChainPem: other.certificatePem,
          keyid: "main",
        },
      }).pipe(Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      const error = failureError(exit);
      expect(error?._tag).toBe("UpdatePublishError");
    }),
  );
});
