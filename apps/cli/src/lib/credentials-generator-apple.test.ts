import {
  generateIdentity,
  generateVaultKey,
  wrapVaultKey,
} from "@better-update/credentials-crypto";
import { toBase64 } from "@better-update/encoding";
import { FileSystem } from "@effect/platform";
import { it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";

import type { Identity } from "@better-update/credentials-crypto";
import type { RequestContext } from "@expo/apple-utils";
// eslint-disable-next-line import-plugin/no-namespace -- vi.mock factory accepts a partial of the entire module shape; namespace import is the only way to satisfy ModuleMockFactoryWithHelper at compile time
import type * as AppleUtilsModule from "@expo/apple-utils";

import { CliRuntime } from "../services/cli-runtime";
import { IdentityStore } from "../services/identity-store";
import { computeDeviceRosterHashHex } from "./credentials-generator";
import {
  generateAndUploadApnsKeyViaAppleId,
  listApnsKeysViaAppleId,
  revokeLocalApnsKey,
} from "./credentials-generator-apns";
import {
  generateAndUploadDistributionCertificate,
  generateAndUploadProvisioningProfile,
  listDistributionCerts,
  revokeDistributionCert,
} from "./credentials-generator-apple";
import { makeInteractiveModeLayer } from "./interactive-mode";

import type { ApiClient } from "../services/api-client";
// eslint-disable-next-line import-plugin/no-namespace -- same reason: typed vi.mock factory needs the full module namespace type
import type * as AppleCertToP12Module from "./apple-cert-to-p12";

// ── module-level mocks ──────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  certificateGetAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  certificateDeleteAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  bundleIdFindAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  bundleIdCreateAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  profileCreateAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  deviceGetAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  deviceCreateAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  createCertAndP12Async: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  extractMetadataFromP12: vi.fn<(params: { p12Base64: string; password: string }) => unknown>(),
  keysCreateAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  keysDownloadAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  keysGetAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  keysGetInfoAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  keysRevokeAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  applePushKeysUpload: vi.fn<(...args: unknown[]) => unknown>(),
  applePushKeysDelete: vi.fn<(...args: unknown[]) => unknown>(),
  // Stand-in for apple-utils' MaxKeysCreatedError so the SUT's instanceof check
  // (AppleUtils.Keys.MaxKeysCreatedError) resolves against the same constructor.
  MaxKeysCreatedError: class MaxKeysCreatedError extends Error {
    public override readonly name = "MaxKeysCreatedError";
  },
}));

vi.mock(import("./apple-cert-to-p12"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    extractMetadataFromP12: (params: { p12Base64: string; password: string }) =>
      Effect.sync(() => mocks.extractMetadataFromP12(params)),
  } as unknown as typeof AppleCertToP12Module;
});

vi.mock(import("@expo/apple-utils"), () => {
  const mocked = {
    Certificate: {
      getAsync: mocks.certificateGetAsync,
      deleteAsync: mocks.certificateDeleteAsync,
    },
    BundleId: { findAsync: mocks.bundleIdFindAsync, createAsync: mocks.bundleIdCreateAsync },
    Profile: { createAsync: mocks.profileCreateAsync },
    Device: { getAsync: mocks.deviceGetAsync, createAsync: mocks.deviceCreateAsync },
    Keys: {
      createKeyAsync: mocks.keysCreateAsync,
      downloadKeyAsync: mocks.keysDownloadAsync,
      getKeysAsync: mocks.keysGetAsync,
      getKeyInfoAsync: mocks.keysGetInfoAsync,
      revokeKeyAsync: mocks.keysRevokeAsync,
      MaxKeysCreatedError: mocks.MaxKeysCreatedError,
      AppStoreKeyServiceConfigID: {
        APNS: "U27F4V844T",
        DEVICE_CHECK: "DQ8HTZ7739",
        MUSIC_KIT: "6A7HVUVQ3M",
      },
    },
    createCertificateAndP12Async: mocks.createCertAndP12Async,
    CertificateType: {
      IOS_DISTRIBUTION: "IOS_DISTRIBUTION",
      IOS_DEVELOPMENT: "IOS_DEVELOPMENT",
      DEVELOPER_ID_APPLICATION: "DEVELOPER_ID_APPLICATION",
    },
    ProfileType: {
      IOS_APP_STORE: "IOS_APP_STORE",
      IOS_APP_ADHOC: "IOS_APP_ADHOC",
      IOS_APP_DEVELOPMENT: "IOS_APP_DEVELOPMENT",
      IOS_APP_INHOUSE: "IOS_APP_INHOUSE",
    },
    BundleIdPlatform: { IOS: "IOS" },
  };
  // Source code uses `import AppleUtils from "@expo/apple-utils"` (default import) because
  // the package is ncc-bundled CJS; Node ESM exposes module.exports as `default`. Mirror that
  // here so the default export resolves to the same flat namespace.
  return { ...mocked, default: mocked } as unknown as typeof AppleUtilsModule;
});

// ── helpers ─────────────────────────────────────────────────────

const certListItem = {
  id: "cert-local-1",
  serialNumber: "abc12345",
  appleTeamId: "TEAM1234",
};

interface TestVault {
  readonly identity: Identity;
  readonly wrappedVaultKey: string;
}

/** Real identity + wrapped vault key so `sealForUpload`'s live unlock path works. */
const makeTestVault = Effect.gen(function* () {
  const identity = yield* Effect.promise(async () => generateIdentity());
  const vaultKey = generateVaultKey();
  const wrappedVaultKey = toBase64(
    yield* Effect.promise(async () => wrapVaultKey({ vaultKey, recipient: identity.publicKey })),
  );
  return { identity, wrappedVaultKey } satisfies TestVault;
});

interface RosterItem {
  readonly id: string;
  readonly identifier: string;
  readonly name: string;
  readonly enabled: boolean;
}

/** Payloads captured from api calls so tests can assert on them. */
const recordedDeviceSyncs: unknown[] = [];
const recordedProfileUploads: { deviceRosterHash?: string; isManaged?: boolean }[] = [];

const buildApi = (vault: TestVault, roster: readonly RosterItem[] = []) =>
  ({
    me: { get: () => Effect.succeed({ activeOrganization: { id: "org-1" } }) },
    devices: {
      syncDevices: (args: unknown) =>
        Effect.sync(() => {
          recordedDeviceSyncs.push(args);
          return { created: 0, linked: 0, unchanged: 0 };
        }),
      list: () => Effect.succeed({ items: roster, total: roster.length }),
    },
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
      getWrap: () => Effect.succeed({ vaultVersion: 1, wrappedKey: vault.wrappedVaultKey }),
    },
    appleDistributionCertificates: {
      list: () => Effect.succeed({ items: [certListItem] }),
      upload: () => Effect.succeed({ id: "cert-local-1", appleTeamId: "team-uuid-1" }),
    },
    appleProvisioningProfiles: {
      upload: (args: { payload: { deviceRosterHash?: string; isManaged?: boolean } }) =>
        Effect.sync(() => {
          recordedProfileUploads.push(args.payload);
          return {
            id: "profile-local-1",
            bundleIdentifier: "com.example.app",
            distributionType: "APP_STORE",
            profileName: "test",
            validUntil: "2030-01-01T00:00:00Z",
            developerPortalIdentifier: "dev-portal-1",
          };
        }),
    },
    applePushKeys: {
      upload: mocks.applePushKeysUpload,
      delete: mocks.applePushKeysDelete,
    },
  }) as unknown as ApiClient;

// FileSystem stub: the APNs generator references FileSystem in its rescue path,
// and every credential upload now resolves the linked project id best-effort
// (auto-bind, spec §1a) — the failing read makes that resolve to "not linked".
// Record writes so the upload-failure test can assert the .p8 was rescued to disk.
const recordedWrites: { path: string; content: string }[] = [];
const fsStubLayer = Layer.succeed(FileSystem.FileSystem, {
  readFileString: () => Effect.fail(new Error("no filesystem in tests")),
  writeFileString: (path: string, content: string) =>
    Effect.sync(() => {
      recordedWrites.push({ path, content });
    }),
} as unknown as FileSystem.FileSystem);

/** CliRuntime surfacing the env identity so the vault unlocks without a passphrase. */
const vaultLayer = (privateKey: string) =>
  Layer.mergeAll(
    fsStubLayer,
    makeInteractiveModeLayer(false),
    Layer.succeed(CliRuntime, {
      argv: [],
      platform: "linux",
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

const context: RequestContext = { teamId: "TEAM1234", providerId: 100 };

beforeEach(() => {
  vi.clearAllMocks();
  recordedWrites.length = 0;
  recordedDeviceSyncs.length = 0;
  recordedProfileUploads.length = 0;
});

const PEM = "-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMG\n-----END PRIVATE KEY-----\n";
const apnsServiceList = [{ id: "U27F4V844T", name: "APNS", configurations: [] }];

const UDID_A = "00008020-001d09503c68002e";
const UDID_B = "fb55a12d0a917a55de9d773818bfb67586cf4484";
const UDID_C = "00008030-001078380cd9802e";

// ── tests ──────────────────────────────────────────────────────

describe(generateAndUploadProvisioningProfile, () => {
  it.effect("APP_STORE: skips device collection and uses existing bundle id", () =>
    Effect.gen(function* () {
      mocks.certificateGetAsync.mockResolvedValue([
        {
          id: "cert-asc-1",
          attributes: { serialNumber: "abc12345" },
        },
      ]);
      mocks.bundleIdFindAsync.mockResolvedValue({ id: "bundle-asc-1" });
      mocks.profileCreateAsync.mockResolvedValue({
        attributes: { profileContent: btoa("fake-profile") },
      });

      const api = buildApi(yield* makeTestVault);
      const result = yield* generateAndUploadProvisioningProfile(api, {
        context,
        distributionCertificateId: "cert-local-1",
        bundleIdentifier: "com.example.app",
        distributionType: "APP_STORE",
      });

      expect(result.id).toBe("profile-local-1");
      // The raw .mobileprovision bytes are returned for inline install (build path).
      expect(result.profileBase64).toBe(btoa("fake-profile"));
      expect(mocks.bundleIdFindAsync).toHaveBeenCalledTimes(1);
      expect(mocks.bundleIdCreateAsync).not.toHaveBeenCalled();
      expect(mocks.deviceGetAsync).not.toHaveBeenCalled();
      const [, profileArgs] = mocks.profileCreateAsync.mock.calls[0] as [
        unknown,
        { bundleId: string; certificates: string[]; devices: string[]; profileType: string },
      ];
      expect(profileArgs.bundleId).toBe("bundle-asc-1");
      expect(profileArgs.certificates).toStrictEqual(["cert-asc-1"]);
      expect(profileArgs.devices).toStrictEqual([]);
      expect(profileArgs.profileType).toBe("IOS_APP_STORE");
    }).pipe(Effect.provide(vaultLayer("unused-identity"))),
  );

  it.effect(
    "AD_HOC: fingerprints the backend roster's UDIDs and attaches every matching portal record",
    () =>
      Effect.gen(function* () {
        mocks.certificateGetAsync.mockResolvedValue([
          { id: "cert-asc-1", attributes: { serialNumber: "abc12345" } },
        ]);
        mocks.bundleIdFindAsync.mockResolvedValue(null);
        mocks.bundleIdCreateAsync.mockResolvedValue({ id: "bundle-asc-new" });
        // Apple lists device A twice (disable + re-add keeps the UDID) — both
        // records attach, but the fingerprint must collapse them to one UDID.
        mocks.deviceGetAsync.mockResolvedValue([
          { id: "rec-a1", attributes: { udid: UDID_A, name: "iPhone A", deviceClass: "IPHONE" } },
          {
            id: "rec-a2",
            attributes: { udid: UDID_A.toUpperCase(), name: "iPhone A", deviceClass: "IPHONE" },
          },
          { id: "rec-b", attributes: { udid: UDID_B, name: "iPhone B", deviceClass: "IPHONE" } },
        ]);
        mocks.profileCreateAsync.mockResolvedValue({
          attributes: { profileContent: btoa("fake-adhoc") },
        });

        const api = buildApi(yield* makeTestVault, [
          { id: "dev-a", identifier: UDID_A, name: "iPhone A", enabled: true },
          { id: "dev-b", identifier: UDID_B, name: "iPhone B", enabled: true },
          { id: "dev-off", identifier: UDID_C, name: "Disabled", enabled: false },
        ]);
        yield* generateAndUploadProvisioningProfile(api, {
          context,
          distributionCertificateId: "cert-local-1",
          bundleIdentifier: "com.example.app",
          distributionType: "AD_HOC",
        });

        expect(mocks.bundleIdCreateAsync).toHaveBeenCalledTimes(1);
        // The portal snapshot is pull-reconciled into the backend first.
        expect(recordedDeviceSyncs).toHaveLength(1);
        const [, profileArgs] = mocks.profileCreateAsync.mock.calls[0] as [
          unknown,
          { profileType: string; devices: string[] },
        ];
        expect(profileArgs.profileType).toBe("IOS_APP_ADHOC");
        expect(profileArgs.devices).toStrictEqual(["rec-a1", "rec-a2", "rec-b"]);
        expect(recordedProfileUploads[0]?.isManaged).toBe(true);
        // Fingerprint = enabled roster UDIDs — duplicate portal records and the
        // disabled device do not shift it.
        expect(recordedProfileUploads[0]?.deviceRosterHash).toBe(
          computeDeviceRosterHashHex([UDID_A, UDID_B]),
        );
      }).pipe(Effect.provide(vaultLayer("unused-identity"))),
  );

  it.effect("AD_HOC: registers backend-only devices on the portal before provisioning", () =>
    Effect.gen(function* () {
      mocks.certificateGetAsync.mockResolvedValue([
        { id: "cert-asc-1", attributes: { serialNumber: "abc12345" } },
      ]);
      mocks.bundleIdFindAsync.mockResolvedValue({ id: "bundle-asc-1" });
      mocks.deviceGetAsync.mockResolvedValue([
        { id: "rec-a", attributes: { udid: UDID_A, name: "iPhone A", deviceClass: "IPHONE" } },
      ]);
      mocks.deviceCreateAsync.mockResolvedValue({
        id: "rec-new",
        attributes: { udid: UDID_B, name: "iPhone B", deviceClass: "IPHONE" },
      });
      mocks.profileCreateAsync.mockResolvedValue({
        attributes: { profileContent: btoa("fake-adhoc") },
      });

      const api = buildApi(yield* makeTestVault, [
        { id: "dev-a", identifier: UDID_A, name: "iPhone A", enabled: true },
        { id: "dev-b", identifier: UDID_B, name: "iPhone B", enabled: true },
      ]);
      yield* generateAndUploadProvisioningProfile(api, {
        context,
        distributionCertificateId: "cert-local-1",
        bundleIdentifier: "com.example.app",
        distributionType: "AD_HOC",
      });

      expect(mocks.deviceCreateAsync).toHaveBeenCalledTimes(1);
      const [, createArgs] = mocks.deviceCreateAsync.mock.calls[0] as [
        unknown,
        { udid: string; platform: string },
      ];
      expect(createArgs.udid).toBe(UDID_B);
      const [, profileArgs] = mocks.profileCreateAsync.mock.calls[0] as [
        unknown,
        { devices: string[] },
      ];
      expect(profileArgs.devices).toStrictEqual(["rec-a", "rec-new"]);
    }).pipe(Effect.provide(vaultLayer("unused-identity"))),
  );

  it.effect("AD_HOC: a --device-ids subset is stored unmanaged without a fingerprint", () =>
    Effect.gen(function* () {
      mocks.certificateGetAsync.mockResolvedValue([
        { id: "cert-asc-1", attributes: { serialNumber: "abc12345" } },
      ]);
      mocks.bundleIdFindAsync.mockResolvedValue({ id: "bundle-asc-1" });
      mocks.deviceGetAsync.mockResolvedValue([
        { id: "rec-a", attributes: { udid: UDID_A, name: "iPhone A", deviceClass: "IPHONE" } },
        { id: "rec-b", attributes: { udid: UDID_B, name: "iPhone B", deviceClass: "IPHONE" } },
      ]);
      mocks.profileCreateAsync.mockResolvedValue({
        attributes: { profileContent: btoa("fake-adhoc") },
      });

      const api = buildApi(yield* makeTestVault, [
        { id: "dev-a", identifier: UDID_A, name: "iPhone A", enabled: true },
        { id: "dev-b", identifier: UDID_B, name: "iPhone B", enabled: true },
      ]);
      yield* generateAndUploadProvisioningProfile(api, {
        context,
        distributionCertificateId: "cert-local-1",
        bundleIdentifier: "com.example.app",
        distributionType: "AD_HOC",
        deviceIds: ["dev-a"],
      });

      const [, profileArgs] = mocks.profileCreateAsync.mock.calls[0] as [
        unknown,
        { devices: string[] },
      ];
      expect(profileArgs.devices).toStrictEqual(["rec-a"]);
      expect(recordedProfileUploads[0]?.isManaged).toBe(false);
      expect(recordedProfileUploads[0]?.deviceRosterHash).toBeUndefined();
    }).pipe(Effect.provide(vaultLayer("unused-identity"))),
  );

  it.effect("fails when Apple has no matching certificate for the local serial number", () =>
    Effect.gen(function* () {
      mocks.certificateGetAsync.mockResolvedValue([
        { id: "cert-asc-other", attributes: { serialNumber: "zz9999" } },
      ]);
      mocks.bundleIdFindAsync.mockResolvedValue({ id: "bundle-asc-1" });

      const api = buildApi(yield* makeTestVault);
      const exit = yield* Effect.exit(
        generateAndUploadProvisioningProfile(api, {
          context,
          distributionCertificateId: "cert-local-1",
          bundleIdentifier: "com.example.app",
          distributionType: "APP_STORE",
        }),
      );

      expect(exit._tag).toBe("Failure");
    }).pipe(Effect.provide(vaultLayer("unused-identity"))),
  );
});

describe(generateAndUploadDistributionCertificate, () => {
  it.effect("maps Apple cert-limit message to CertificateLimitError", () =>
    Effect.gen(function* () {
      mocks.createCertAndP12Async.mockRejectedValue(
        new Error(
          "There is a problem with the request entity - You already have a current iOS Distribution certificate or a pending certificate request.",
        ),
      );

      const vault = yield* makeTestVault;
      const api = buildApi(vault);
      const exit = yield* Effect.exit(
        generateAndUploadDistributionCertificate(api, { context }),
      ).pipe(Effect.provide(vaultLayer(vault.identity.privateKey)));

      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        const failure = exit.cause.toJSON() as { failure?: { _tag?: string } };
        expect(failure.failure?._tag).toBe("CertificateLimitError");
      }
    }),
  );

  it.effect("maps unrelated apple-utils failures to AppleIdGenerateFailedError", () =>
    Effect.gen(function* () {
      mocks.createCertAndP12Async.mockRejectedValue(new Error("network down"));

      const vault = yield* makeTestVault;
      const api = buildApi(vault);
      const exit = yield* Effect.exit(
        generateAndUploadDistributionCertificate(api, { context }),
      ).pipe(Effect.provide(vaultLayer(vault.identity.privateKey)));

      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        const failure = exit.cause.toJSON() as { failure?: { _tag?: string } };
        expect(failure.failure?._tag).toBe("AppleIdGenerateFailedError");
      }
    }),
  );

  // Regression: previously returned metadata.appleTeamId (the Apple Developer string from
  // p12 OU, e.g. "ABCDE12345") instead of the apple_teams row UUID from the API response.
  // Caller then sent the Apple string to POST /ios-bundle-configurations, hitting a
  // FOREIGN KEY violation against apple_teams(id) and a 500 → opaque "Decode error".
  it.effect("returns the apple_teams UUID alongside the Apple Developer identifier", () =>
    Effect.gen(function* () {
      mocks.createCertAndP12Async.mockResolvedValue({
        certificateP12: "fake-p12-base64",
        password: "fake-password",
        certificate: { id: "cert-developer-portal-1" },
      });
      mocks.extractMetadataFromP12.mockReturnValue({
        serialNumber: "ABC123",
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2027-01-01T00:00:00Z",
        appleTeamId: "TEAM123456",
        appleTeamName: "Acme Inc.",
        developerIdIdentifier: null,
        commonName: "iPhone Distribution: Acme",
      });

      const vault = yield* makeTestVault;
      const api = buildApi(vault);
      const result = yield* generateAndUploadDistributionCertificate(api, {
        context,
      }).pipe(Effect.provide(vaultLayer(vault.identity.privateKey)));

      expect(result.id).toBe("cert-local-1");
      expect(result.appleTeamId).toBe("team-uuid-1");
      expect(result.appleTeamIdentifier).toBe("TEAM123456");
      expect(result.developerPortalIdentifier).toBe("cert-developer-portal-1");
    }),
  );
});

describe(listDistributionCerts, () => {
  it.effect("maps Apple Certificate.getAsync items to summaries", () =>
    Effect.gen(function* () {
      mocks.certificateGetAsync.mockResolvedValue([
        {
          id: "cert-asc-1",
          attributes: {
            serialNumber: "ABC123",
            displayName: "iOS Distribution: Acme",
            certificateType: "IOS_DISTRIBUTION",
            expirationDate: "2030-01-01T00:00:00.000+0000",
          },
        },
      ]);

      const result = yield* listDistributionCerts(context, "IOS_DISTRIBUTION");

      expect(result).toStrictEqual([
        {
          developerPortalIdentifier: "cert-asc-1",
          serialNumber: "ABC123",
          displayName: "iOS Distribution: Acme",
          certificateType: "IOS_DISTRIBUTION",
          expirationDate: "2030-01-01T00:00:00.000+0000",
        },
      ]);
      const [, args] = mocks.certificateGetAsync.mock.calls[0] as [
        unknown,
        { query: { filter: { certificateType: string } } },
      ];
      expect(args.query.filter.certificateType).toBe("IOS_DISTRIBUTION");
    }),
  );

  it.effect("filters by DEVELOPER_ID_APPLICATION for macOS Developer ID certs", () =>
    Effect.gen(function* () {
      mocks.certificateGetAsync.mockResolvedValue([]);

      const result = yield* listDistributionCerts(context, "DEVELOPER_ID_APPLICATION");

      expect(result).toStrictEqual([]);
      const [, args] = mocks.certificateGetAsync.mock.calls[0] as [
        unknown,
        { query: { filter: { certificateType: string } } },
      ];
      expect(args.query.filter.certificateType).toBe("DEVELOPER_ID_APPLICATION");
    }),
  );
});

describe(revokeDistributionCert, () => {
  it.effect("invokes Certificate.deleteAsync with the developer-portal id", () =>
    Effect.gen(function* () {
      mocks.certificateDeleteAsync.mockResolvedValue(undefined);

      yield* revokeDistributionCert(context, "cert-asc-1");

      expect(mocks.certificateDeleteAsync).toHaveBeenCalledTimes(1);
      const [, args] = mocks.certificateDeleteAsync.mock.calls[0] as [unknown, { id: string }];
      expect(args.id).toBe("cert-asc-1");
    }),
  );
});

const failureTag = (exit: Exit.Exit<unknown, unknown>): string | undefined => {
  if (!Exit.isFailure(exit)) {
    return undefined;
  }
  const json = exit.cause.toJSON() as { failure?: { _tag?: string } };
  return json.failure?._tag;
};

describe(generateAndUploadApnsKeyViaAppleId, () => {
  it.effect("creates an APNs key, downloads it, and uploads only the sealed envelope", () =>
    Effect.gen(function* () {
      mocks.keysCreateAsync.mockResolvedValue({
        id: "APNSKEY123",
        name: "my key",
        canDownload: true,
        canRevoke: true,
        services: [],
      });
      mocks.keysDownloadAsync.mockResolvedValue(PEM);
      mocks.applePushKeysUpload.mockReturnValue(Effect.succeed({ id: "push-local-1" }));

      const vault = yield* makeTestVault;
      const api = buildApi(vault);
      const result = yield* generateAndUploadApnsKeyViaAppleId(api, {
        context,
        appleTeamIdentifier: "TEAM1234",
        appleTeamName: "Acme Inc.",
        name: "my key",
      }).pipe(Effect.provide(vaultLayer(vault.identity.privateKey)));

      expect(result.id).toBe("push-local-1");
      expect(result.keyId).toBe("APNSKEY123");
      const [, createArgs] = mocks.keysCreateAsync.mock.calls[0] as [unknown, { isApns?: boolean }];
      expect(createArgs.isApns).toBe(true);
      const [, downloadArgs] = mocks.keysDownloadAsync.mock.calls[0] as [unknown, { id: string }];
      expect(downloadArgs.id).toBe("APNSKEY123");
      // E2E: the upload body carries the sealed envelope + public metadata, never the raw PEM.
      const [uploadArg] = mocks.applePushKeysUpload.mock.calls[0] as [
        {
          payload: {
            keyId: string;
            appleTeamIdentifier: string;
            appleTeamName?: string;
            ciphertext: string;
          };
        },
      ];
      expect(uploadArg.payload.keyId).toBe("APNSKEY123");
      expect(uploadArg.payload.appleTeamIdentifier).toBe("TEAM1234");
      expect(uploadArg.payload.appleTeamName).toBe("Acme Inc.");
      expect(uploadArg.payload.ciphertext).toBeTypeOf("string");
      expect(JSON.stringify(uploadArg.payload)).not.toContain("BEGIN PRIVATE KEY");
      expect(recordedWrites).toHaveLength(0);
    }),
  );

  it.effect("maps apple-utils MaxKeysCreatedError to ApnsKeyLimitError", () =>
    Effect.gen(function* () {
      mocks.keysCreateAsync.mockRejectedValue(new mocks.MaxKeysCreatedError("too many keys"));

      const vault = yield* makeTestVault;
      const api = buildApi(vault);
      const exit = yield* Effect.exit(
        generateAndUploadApnsKeyViaAppleId(api, {
          context,
          appleTeamIdentifier: "TEAM1234",
          appleTeamName: null,
          name: "x",
        }),
      ).pipe(Effect.provide(vaultLayer(vault.identity.privateKey)));

      expect(failureTag(exit)).toBe("ApnsKeyLimitError");
    }),
  );

  // Real Apple behavior (verified live): at the cap, createKeyAsync rejects with a
  // plain server error, NOT a typed MaxKeysCreatedError — so the wording must be matched.
  it.effect("maps Apple's plain key-limit error message to ApnsKeyLimitError", () =>
    Effect.gen(function* () {
      mocks.keysCreateAsync.mockRejectedValue(
        new Error(
          "Apple provided the following error info:\nYou have already reached the maximum allowed number of team scoped Keys for this service in production and sandbox environments.",
        ),
      );

      const vault = yield* makeTestVault;
      const api = buildApi(vault);
      const exit = yield* Effect.exit(
        generateAndUploadApnsKeyViaAppleId(api, {
          context,
          appleTeamIdentifier: "TEAM1234",
          appleTeamName: null,
          name: "x",
        }),
      ).pipe(Effect.provide(vaultLayer(vault.identity.privateKey)));

      expect(failureTag(exit)).toBe("ApnsKeyLimitError");
    }),
  );

  it.effect("surfaces a download failure without swallowing the orphaned key", () =>
    Effect.gen(function* () {
      mocks.keysCreateAsync.mockResolvedValue({
        id: "APNSKEY123",
        name: "n",
        canDownload: true,
        canRevoke: true,
        services: [],
      });
      mocks.keysDownloadAsync.mockRejectedValue(new Error("download exploded"));

      const vault = yield* makeTestVault;
      const api = buildApi(vault);
      const exit = yield* Effect.exit(
        generateAndUploadApnsKeyViaAppleId(api, {
          context,
          appleTeamIdentifier: "TEAM1234",
          appleTeamName: null,
          name: "x",
        }),
      ).pipe(Effect.provide(vaultLayer(vault.identity.privateKey)));

      expect(failureTag(exit)).toBe("AppleIdGenerateFailedError");
      expect(recordedWrites).toHaveLength(0);
    }),
  );

  it.effect("rescues the .p8 to disk when upload fails after the one-shot download", () =>
    Effect.gen(function* () {
      mocks.keysCreateAsync.mockResolvedValue({
        id: "APNSKEY123",
        name: "n",
        canDownload: true,
        canRevoke: true,
        services: [],
      });
      mocks.keysDownloadAsync.mockResolvedValue(PEM);
      mocks.applePushKeysUpload.mockReturnValue(Effect.fail(new Error("upload boom")));

      const vault = yield* makeTestVault;
      const api = buildApi(vault);
      const exit = yield* Effect.exit(
        generateAndUploadApnsKeyViaAppleId(api, {
          context,
          appleTeamIdentifier: "TEAM1234",
          appleTeamName: null,
          name: "x",
        }),
      ).pipe(Effect.provide(vaultLayer(vault.identity.privateKey)));

      expect(failureTag(exit)).toBe("AppleIdGenerateFailedError");
      expect(recordedWrites).toHaveLength(1);
      expect(recordedWrites[0]?.path).toBe("AuthKey_APNSKEY123.p8");
      expect(recordedWrites[0]?.content).toContain("BEGIN PRIVATE KEY");
    }),
  );
});

describe(listApnsKeysViaAppleId, () => {
  it.effect("returns only APNs keys with their revocability", () =>
    Effect.gen(function* () {
      mocks.keysGetAsync.mockResolvedValue([{ id: "k1" }, { id: "k2" }]);
      mocks.keysGetInfoAsync.mockImplementation(async (...args: unknown[]) => {
        const { id } = args[1] as { id: string };
        return id === "k1"
          ? {
              id: "k1",
              name: "apns one",
              canDownload: false,
              canRevoke: true,
              services: apnsServiceList,
            }
          : {
              id: "k2",
              name: "devicecheck",
              canDownload: false,
              canRevoke: true,
              services: [{ id: "DQ8HTZ7739", name: "DeviceCheck", configurations: [] }],
            };
      });

      const result = yield* listApnsKeysViaAppleId(context);

      expect(result).toStrictEqual([
        { developerPortalKeyId: "k1", name: "apns one", canRevoke: true },
      ]);
    }),
  );
});

describe(revokeLocalApnsKey, () => {
  it.effect("revokes on Apple and deletes locally when the key is still present", () =>
    Effect.gen(function* () {
      mocks.keysGetAsync.mockResolvedValue([{ id: "APNSKEY123" }]);
      mocks.keysGetInfoAsync.mockResolvedValue({
        id: "APNSKEY123",
        name: "n",
        canDownload: false,
        canRevoke: true,
        services: apnsServiceList,
      });
      mocks.keysRevokeAsync.mockResolvedValue(undefined);
      mocks.applePushKeysDelete.mockReturnValue(Effect.succeed({ deleted: true }));

      const api = buildApi(yield* makeTestVault);
      const result = yield* revokeLocalApnsKey(api, {
        context,
        pushKeyId: "push-local-1",
        keyId: "APNSKEY123",
        keepLocal: false,
      });

      expect(result).toStrictEqual({
        localId: "push-local-1",
        keyId: "APNSKEY123",
        revokedOnApple: true,
        deletedLocally: true,
      });
      expect(mocks.keysRevokeAsync).toHaveBeenCalledTimes(1);
      expect(mocks.applePushKeysDelete).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect("keeps the local copy and skips delete when keepLocal is set", () =>
    Effect.gen(function* () {
      mocks.keysGetAsync.mockResolvedValue([{ id: "APNSKEY123" }]);
      mocks.keysGetInfoAsync.mockResolvedValue({
        id: "APNSKEY123",
        name: "n",
        canDownload: false,
        canRevoke: true,
        services: apnsServiceList,
      });
      mocks.keysRevokeAsync.mockResolvedValue(undefined);

      const api = buildApi(yield* makeTestVault);
      const result = yield* revokeLocalApnsKey(api, {
        context,
        pushKeyId: "push-local-1",
        keyId: "APNSKEY123",
        keepLocal: true,
      });

      expect(result.deletedLocally).toBe(false);
      expect(mocks.applePushKeysDelete).not.toHaveBeenCalled();
    }),
  );

  it.effect("does not revoke a key already gone from the portal but still deletes locally", () =>
    Effect.gen(function* () {
      mocks.keysGetAsync.mockResolvedValue([]);
      mocks.applePushKeysDelete.mockReturnValue(Effect.succeed({ deleted: true }));

      const api = buildApi(yield* makeTestVault);
      const result = yield* revokeLocalApnsKey(api, {
        context,
        pushKeyId: "push-local-1",
        keyId: "GONEKEY999",
        keepLocal: false,
      });

      expect(result.revokedOnApple).toBe(false);
      expect(result.deletedLocally).toBe(true);
      expect(mocks.keysRevokeAsync).not.toHaveBeenCalled();
      expect(mocks.applePushKeysDelete).toHaveBeenCalledTimes(1);
    }),
  );
});
