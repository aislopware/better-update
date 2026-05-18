import { it } from "@effect/vitest";
import { Effect } from "effect";

import type { RequestContext } from "@expo/apple-utils";
// eslint-disable-next-line import-plugin/no-namespace -- vi.mock factory accepts a partial of the entire module shape; namespace import is the only way to satisfy ModuleMockFactoryWithHelper at compile time
import type * as AppleUtilsModule from "@expo/apple-utils";

import {
  generateAndUploadDistributionCertificateViaAppleId,
  generateAndUploadProvisioningProfileViaAppleId,
  listDistributionCertsViaAppleId,
  revokeDistributionCertViaAppleId,
} from "./credentials-generator-apple-id";

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
  deviceGetAllIosAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  createCertAndP12Async: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  extractMetadataFromP12: vi.fn<(params: { p12Base64: string; password: string }) => unknown>(),
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
    Device: { getAllIOSProfileDevicesAsync: mocks.deviceGetAllIosAsync },
    createCertificateAndP12Async: mocks.createCertAndP12Async,
    CertificateType: {
      IOS_DISTRIBUTION: "IOS_DISTRIBUTION",
      IOS_DEVELOPMENT: "IOS_DEVELOPMENT",
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

const buildApi = () =>
  ({
    appleDistributionCertificates: {
      list: () => Effect.succeed({ items: [certListItem] }),
      upload: () => Effect.succeed({ id: "cert-local-1", appleTeamId: "team-uuid-1" }),
    },
    appleProvisioningProfiles: {
      upload: () =>
        Effect.succeed({
          id: "profile-local-1",
          bundleIdentifier: "com.example.app",
          distributionType: "APP_STORE",
          profileName: "test",
          validUntil: "2030-01-01T00:00:00Z",
          developerPortalIdentifier: "dev-portal-1",
        }),
    },
  }) as unknown as ApiClient;

const context: RequestContext = { teamId: "TEAM1234", providerId: 100 };

beforeEach(() => {
  vi.clearAllMocks();
});

// ── tests ──────────────────────────────────────────────────────

describe(generateAndUploadProvisioningProfileViaAppleId, () => {
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

      const api = buildApi();
      const result = yield* generateAndUploadProvisioningProfileViaAppleId(api, {
        context,
        distributionCertificateId: "cert-local-1",
        bundleIdentifier: "com.example.app",
        distributionType: "APP_STORE",
      });

      expect(result.id).toBe("profile-local-1");
      expect(mocks.bundleIdFindAsync).toHaveBeenCalledTimes(1);
      expect(mocks.bundleIdCreateAsync).not.toHaveBeenCalled();
      expect(mocks.deviceGetAllIosAsync).not.toHaveBeenCalled();
      const [, profileArgs] = mocks.profileCreateAsync.mock.calls[0] as [
        unknown,
        { bundleId: string; certificates: string[]; devices: string[]; profileType: string },
      ];
      expect(profileArgs.bundleId).toBe("bundle-asc-1");
      expect(profileArgs.certificates).toStrictEqual(["cert-asc-1"]);
      expect(profileArgs.devices).toStrictEqual([]);
      expect(profileArgs.profileType).toBe("IOS_APP_STORE");
    }),
  );

  it.effect("AD_HOC: enrolls devices and includes them in profile request", () =>
    Effect.gen(function* () {
      mocks.certificateGetAsync.mockResolvedValue([
        { id: "cert-asc-1", attributes: { serialNumber: "abc12345" } },
      ]);
      mocks.bundleIdFindAsync.mockResolvedValue(null);
      mocks.bundleIdCreateAsync.mockResolvedValue({ id: "bundle-asc-new" });
      mocks.deviceGetAllIosAsync.mockResolvedValue([{ id: "dev1" }, { id: "dev2" }]);
      mocks.profileCreateAsync.mockResolvedValue({
        attributes: { profileContent: btoa("fake-adhoc") },
      });

      const api = buildApi();
      yield* generateAndUploadProvisioningProfileViaAppleId(api, {
        context,
        distributionCertificateId: "cert-local-1",
        bundleIdentifier: "com.example.app",
        distributionType: "AD_HOC",
      });

      expect(mocks.bundleIdCreateAsync).toHaveBeenCalledTimes(1);
      expect(mocks.deviceGetAllIosAsync).toHaveBeenCalledTimes(1);
      const [, profileArgs] = mocks.profileCreateAsync.mock.calls[0] as [
        unknown,
        { profileType: string; devices: string[] },
      ];
      expect(profileArgs.profileType).toBe("IOS_APP_ADHOC");
      expect(profileArgs.devices).toStrictEqual(["dev1", "dev2"]);
    }),
  );

  it.effect("fails when Apple has no matching certificate for the local serial number", () =>
    Effect.gen(function* () {
      mocks.certificateGetAsync.mockResolvedValue([
        { id: "cert-asc-other", attributes: { serialNumber: "zz9999" } },
      ]);
      mocks.bundleIdFindAsync.mockResolvedValue({ id: "bundle-asc-1" });

      const api = buildApi();
      const exit = yield* Effect.exit(
        generateAndUploadProvisioningProfileViaAppleId(api, {
          context,
          distributionCertificateId: "cert-local-1",
          bundleIdentifier: "com.example.app",
          distributionType: "APP_STORE",
        }),
      );

      expect(exit._tag).toBe("Failure");
    }),
  );
});

describe(generateAndUploadDistributionCertificateViaAppleId, () => {
  it.effect("maps Apple cert-limit message to CertificateLimitError", () =>
    Effect.gen(function* () {
      mocks.createCertAndP12Async.mockRejectedValue(
        new Error(
          "There is a problem with the request entity - You already have a current iOS Distribution certificate or a pending certificate request.",
        ),
      );

      const api = buildApi();
      const exit = yield* Effect.exit(
        generateAndUploadDistributionCertificateViaAppleId(api, { context }),
      );

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

      const api = buildApi();
      const exit = yield* Effect.exit(
        generateAndUploadDistributionCertificateViaAppleId(api, { context }),
      );

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

      const api = buildApi();
      const result = yield* generateAndUploadDistributionCertificateViaAppleId(api, { context });

      expect(result.id).toBe("cert-local-1");
      expect(result.appleTeamId).toBe("team-uuid-1");
      expect(result.appleTeamIdentifier).toBe("TEAM123456");
      expect(result.developerPortalIdentifier).toBe("cert-developer-portal-1");
    }),
  );
});

describe(listDistributionCertsViaAppleId, () => {
  it.effect("maps Apple Certificate.getAsync items to summaries", () =>
    Effect.gen(function* () {
      mocks.certificateGetAsync.mockResolvedValue([
        {
          id: "cert-asc-1",
          attributes: {
            serialNumber: "ABC123",
            displayName: "iOS Distribution: Acme",
            expirationDate: "2030-01-01T00:00:00.000+0000",
          },
        },
      ]);

      const result = yield* listDistributionCertsViaAppleId(context, "IOS_DISTRIBUTION");

      expect(result).toStrictEqual([
        {
          developerPortalIdentifier: "cert-asc-1",
          serialNumber: "ABC123",
          displayName: "iOS Distribution: Acme",
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
});

describe(revokeDistributionCertViaAppleId, () => {
  it.effect("invokes Certificate.deleteAsync with the developer-portal id", () =>
    Effect.gen(function* () {
      mocks.certificateDeleteAsync.mockResolvedValue(undefined);

      yield* revokeDistributionCertViaAppleId(context, "cert-asc-1");

      expect(mocks.certificateDeleteAsync).toHaveBeenCalledTimes(1);
      const [, args] = mocks.certificateDeleteAsync.mock.calls[0] as [unknown, { id: string }];
      expect(args.id).toBe("cert-asc-1");
    }),
  );
});
