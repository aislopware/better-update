import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BunFileSystem } from "@effect/platform-bun";
import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { loadOptionalSignedPayload, loadSignedPublishPayloads } from "./signed-payloads";
import { failureError } from "./test-utils";

const withSignedFiles = () => {
  const dir = mkdtempSync(join(tmpdir(), "signed-payloads-"));
  const manifestPath = join(dir, "manifest.json");
  const signaturePath = join(dir, "manifest.sig");
  const certificatePath = join(dir, "manifest.pem");

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
        makeError: (message) => new Error(message),
      }).pipe(Effect.provide(BunFileSystem.layer), Effect.ensuring(Effect.sync(files.dispose)));

      expect(payload).toEqual({
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
        makeError: (message) => new Error(message),
      }).pipe(Effect.provide(BunFileSystem.layer), Effect.ensuring(Effect.sync(iosFiles.dispose)));

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
        makeError: (message) => new Error(message),
      }).pipe(
        Effect.provide(BunFileSystem.layer),
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
        makeError: (message) => new Error(message),
      }).pipe(
        Effect.provide(BunFileSystem.layer),
        Effect.ensuring(Effect.sync(files.dispose)),
        Effect.exit,
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(failureError(exit)).toEqual(
          new Error(
            "Signed multi-platform publish requires per-platform file sets. Use the --*-ios and --*-android options.",
          ),
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
        makeError: (message) => new Error(message),
      }).pipe(
        Effect.provide(BunFileSystem.layer),
        Effect.ensuring(Effect.sync(files.dispose)),
        Effect.exit,
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(failureError(exit)).toEqual(
          new Error(
            "Signed publish for ios is ambiguous. Use either the generic file options or the ios-specific file options, not both.",
          ),
        );
      }
    }),
  );
});
