import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  generateDek,
  generateIdentity,
  generateVaultKey,
  sealCredential,
  SCHEMA_VERSION,
  wrapDek,
  wrapVaultKey,
} from "@better-update/credentials-crypto";
import { toBase64 } from "@better-update/encoding";
import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import type { Identity } from "@better-update/credentials-crypto";

import { CliRuntime } from "../services/cli-runtime";
import { IdentityStore } from "../services/identity-store";
import { downloadIosCredentials } from "./credentials-downloader";
import { MissingCredentialsError } from "./exit-codes";
import { makeInteractiveModeLayer } from "./interactive-mode";
import { failureError } from "./test-utils";

import type { ApiClient } from "../services/api-client";
import type { DownloadIosCredentialsOptions } from "./credentials-downloader";

// ── helpers ─────────────────────────────────────────────────────

const ORG_ID = "org-1";
const CERT_ID = "cert-1";

const b64 = (raw: string) => Buffer.from(raw, "utf8").toString("base64");

interface ResolveStub {
  readonly ok?: ReadonlyMap<string, IosResolvePayload>;
  readonly notFound?: ReadonlySet<string>;
  readonly forbidden?: ReadonlySet<string>;
}

interface IosResolvePayload {
  readonly mobileprovisionBase64: string;
  readonly profileUuid: string | null;
  readonly ascApiKeyId: string | null;
}

const mainPayload: IosResolvePayload = {
  mobileprovisionBase64: b64("MAIN-PROFILE-BYTES"),
  profileUuid: "uuid-main",
  ascApiKeyId: "asc-key-1",
};

const extensionPayload = (suffix: string): IosResolvePayload => ({
  mobileprovisionBase64: b64(`EXT-${suffix}-BYTES`),
  profileUuid: `uuid-${suffix}`,
  ascApiKeyId: "asc-key-1",
});

const fakeNotFound = (bundleId: string) => ({
  _tag: "NotFound" as const,
  message: `No iOS bundle configuration found for ${bundleId}`,
});

const fakeForbidden = () => ({
  _tag: "Forbidden" as const,
  message: "Permission denied",
});

interface TestVault {
  readonly identity: Identity;
  readonly vaultKey: Uint8Array;
  readonly wrappedVaultKey: string;
  /** A real sealed `.p12` envelope bound to (org, CERT_ID, "distribution-certificate"). */
  readonly certEnvelope: {
    readonly ciphertext: string;
    readonly wrappedDek: string;
    readonly vaultVersion: number;
  };
}

const VAULT_VERSION = 2;

/** Build a real identity + vault + a sealed dist-cert envelope for the resolve stub. */
const makeTestVault = Effect.gen(function* () {
  const identity = yield* Effect.promise(async () => generateIdentity());
  const vaultKey = generateVaultKey();
  const wrappedVaultKey = toBase64(
    yield* Effect.promise(async () => wrapVaultKey({ vaultKey, recipient: identity.publicKey })),
  );
  const dek = generateDek();
  const ciphertext = toBase64(
    sealCredential({
      dek,
      payload: {
        schemaVersion: SCHEMA_VERSION,
        orgId: ORG_ID,
        credentialId: CERT_ID,
        credentialType: "distribution-certificate",
        metadata: {},
        secret: { p12Base64: b64("FAKE-P12-CONTENT-LONG-ENOUGH"), p12Password: "pw" },
      },
    }),
  );
  const wrappedDek = toBase64(
    wrapDek({
      dek,
      vaultKey,
      binding: { orgId: ORG_ID, credentialId: CERT_ID, vaultVersion: VAULT_VERSION },
    }),
  );
  return {
    identity,
    vaultKey,
    wrappedVaultKey,
    certEnvelope: { ciphertext, wrappedDek, vaultVersion: VAULT_VERSION },
  } satisfies TestVault;
});

const buildApi = (stub: ResolveStub, vault: TestVault): ApiClient => {
  const okMap = stub.ok ?? new Map<string, IosResolvePayload>();
  const notFound = stub.notFound ?? new Set<string>();
  const forbidden = stub.forbidden ?? new Set<string>();
  return {
    me: { get: () => Effect.succeed({ activeOrganization: { id: ORG_ID } }) },
    userEncryptionKeys: {
      list: () =>
        Effect.succeed({
          items: [
            {
              id: "key-1",
              publicKey: vault.identity.publicKey,
              fingerprint: vault.identity.fingerprint,
              kind: "device",
              label: "ci",
            },
          ],
        }),
    },
    orgVault: {
      getWrap: () =>
        Effect.succeed({ vaultVersion: VAULT_VERSION, wrappedKey: vault.wrappedVaultKey }),
    },
    buildCredentials: {
      resolve: ({
        payload,
      }: {
        readonly payload: { readonly platform: string; readonly bundleIdentifier: string };
      }) => {
        const bundle = payload.bundleIdentifier;
        if (notFound.has(bundle)) {
          return Effect.fail(fakeNotFound(bundle));
        }
        if (forbidden.has(bundle)) {
          return Effect.fail(fakeForbidden());
        }
        const entry = okMap.get(bundle);
        if (!entry) {
          return Effect.fail(fakeNotFound(bundle));
        }
        return Effect.succeed({
          platform: "ios",
          distributionCertificate: vault.certEnvelope,
          provisioningProfile: {
            mobileprovisionBase64: entry.mobileprovisionBase64,
            uuid: entry.profileUuid,
            name: "Test Profile",
            teamId: "TEAM1234",
            bundleIdentifier: bundle,
            distributionType: "APP_STORE",
          },
          pushKey: null,
          profileStale: false,
          currentDeviceRosterHash: null,
          context: {
            ascApiKeyId: entry.ascApiKeyId,
            distributionCertificateId: CERT_ID,
            appleTeamId: "team-row-1",
            appleTeamIdentifier: "TEAM1234",
          },
        });
      },
    },
  } as unknown as ApiClient;
};

const baseOptions = (tempDir: string): DownloadIosCredentialsOptions => ({
  projectId: "project-1",
  mainBundleIdentifier: "com.example.app",
  bundleIdentifiers: ["com.example.app"],
  distribution: "app-store",
  tempDir,
});

/** CliRuntime that surfaces the env identity so the vault unlocks without a passphrase. */
const vaultLayer = (privateKey: string) =>
  Layer.mergeAll(
    NodeFileSystem.layer,
    makeInteractiveModeLayer(false),
    Layer.succeed(CliRuntime, {
      argv: [],
      platform: "linux" as NodeJS.Platform,
      cwd: Effect.succeed("/"),
      getEnv: (name: string) =>
        Effect.succeed(name === "BETTER_UPDATE_IDENTITY" ? privateKey : undefined),
      homeDirectory: Effect.succeed("/"),
      userName: Effect.succeed("test"),
      commandEnvironment: () => Effect.succeed({}),
      setExitCode: () => Effect.void,
    }),
    Layer.succeed(IdentityStore, {
      load: Effect.sync(() => null),
      save: () => Effect.void,
      clear: Effect.void,
    }),
  );

const runWithTempDir = <Value, Err, R>(
  body: (tempDir: string) => Effect.Effect<Value, Err, R>,
): Effect.Effect<Value, Err, R> =>
  Effect.gen(function* () {
    const tempDir = yield* Effect.promise(async () => mkdtemp(path.join(os.tmpdir(), "bu-test-")));
    const result = yield* Effect.ensuring(
      body(tempDir),
      Effect.promise(async () => rm(tempDir, { recursive: true, force: true })),
    );
    return result;
  });

// ── tests ──────────────────────────────────────────────────────

describe(downloadIosCredentials, () => {
  it.effect("resolves all bundles cleanly without auto-provisioning", () =>
    Effect.gen(function* () {
      const vault = yield* makeTestVault;
      yield* runWithTempDir((tempDir) =>
        Effect.gen(function* () {
          const api = buildApi(
            {
              ok: new Map([
                ["com.example.app", mainPayload],
                ["com.example.app.ext", extensionPayload("ext")],
              ]),
            },
            vault,
          );
          const result = yield* downloadIosCredentials(api, {
            ...baseOptions(tempDir),
            bundleIdentifiers: ["com.example.app", "com.example.app.ext"],
          });
          expect(result.profiles).toHaveLength(2);
          expect(
            result.profiles.map((profile) => profile.bundleIdentifier).toSorted(),
          ).toStrictEqual(["com.example.app", "com.example.app.ext"]);
          expect(result.p12Password).toBe("pw");
        }),
      ).pipe(Effect.provide(vaultLayer(vault.identity.privateKey)));
    }),
  );

  it.effect("fails when main bundle is not registered", () =>
    Effect.gen(function* () {
      const vault = yield* makeTestVault;
      yield* runWithTempDir((tempDir) =>
        Effect.gen(function* () {
          const api = buildApi(
            {
              ok: new Map([["com.example.app.ext", extensionPayload("ext")]]),
              notFound: new Set(["com.example.app"]),
            },
            vault,
          );
          const exit = yield* Effect.exit(
            downloadIosCredentials(api, {
              ...baseOptions(tempDir),
              bundleIdentifiers: ["com.example.app", "com.example.app.ext"],
            }),
          );
          const err = failureError(exit);
          expect(err).toBeInstanceOf(MissingCredentialsError);
          expect(err?.message).toContain("Main app bundle");
        }),
      ).pipe(Effect.provide(vaultLayer(vault.identity.privateKey)));
    }),
  );

  it.effect("fails fast on Forbidden — no auto-provision fallback", () =>
    Effect.gen(function* () {
      const vault = yield* makeTestVault;
      yield* runWithTempDir((tempDir) =>
        Effect.gen(function* () {
          const api = buildApi(
            {
              ok: new Map([["com.example.app", mainPayload]]),
              forbidden: new Set(["com.example.app.ext"]),
            },
            vault,
          );
          const exit = yield* Effect.exit(
            downloadIosCredentials(api, {
              ...baseOptions(tempDir),
              bundleIdentifiers: ["com.example.app", "com.example.app.ext"],
            }),
          );
          const err = failureError(exit);
          expect(err).toBeInstanceOf(MissingCredentialsError);
          expect(err?.message).toContain("Permission denied");
        }),
      ).pipe(Effect.provide(vaultLayer(vault.identity.privateKey)));
    }),
  );

  it.effect("fails when extensions missing AND server returns no ASC key for the team", () =>
    Effect.gen(function* () {
      const vault = yield* makeTestVault;
      yield* runWithTempDir((tempDir) =>
        Effect.gen(function* () {
          const api = buildApi(
            {
              ok: new Map([["com.example.app", { ...mainPayload, ascApiKeyId: null }]]),
              notFound: new Set(["com.example.app.ext"]),
            },
            vault,
          );
          const exit = yield* Effect.exit(
            downloadIosCredentials(api, {
              ...baseOptions(tempDir),
              bundleIdentifiers: ["com.example.app", "com.example.app.ext"],
            }),
          );
          const err = failureError(exit);
          expect(err).toBeInstanceOf(MissingCredentialsError);
          expect(err?.message).toContain("no ASC API key is available");
        }),
      ).pipe(Effect.provide(vaultLayer(vault.identity.privateKey)));
    }),
  );

  it.effect("rejects mainBundleIdentifier missing from bundleIdentifiers list", () =>
    Effect.gen(function* () {
      const vault = yield* makeTestVault;
      yield* runWithTempDir((tempDir) =>
        Effect.gen(function* () {
          const api = buildApi({ ok: new Map([["com.example.app", mainPayload]]) }, vault);
          const exit = yield* Effect.exit(
            downloadIosCredentials(api, {
              ...baseOptions(tempDir),
              mainBundleIdentifier: "com.example.other",
              bundleIdentifiers: ["com.example.app"],
            }),
          );
          const err = failureError(exit);
          expect(err).toBeInstanceOf(MissingCredentialsError);
          expect(err?.message).toContain("missing from bundleIdentifiers");
        }),
      ).pipe(Effect.provide(vaultLayer(vault.identity.privateKey)));
    }),
  );
});
