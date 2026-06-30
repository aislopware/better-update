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
import {
  defaultAscApiKeyNickname,
  generateAndUploadAscApiKeyViaAppleId,
  listAscApiKeysViaAppleId,
} from "./credentials-generator-asc-key";
import { makeInteractiveModeLayer } from "./interactive-mode";

import type { ApiClient } from "../services/api-client";

// ── module-level mocks ──────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  apiKeyCreateAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  apiKeyInfoAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  apiKeyGetAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  apiKeyDownloadAsync: vi.fn<() => Promise<string | null>>(),
  ascApiKeysUpload: vi.fn<(...args: unknown[]) => unknown>(),
}));

vi.mock(import("@expo/apple-utils"), () => {
  const mocked = {
    ApiKey: {
      createAsync: mocks.apiKeyCreateAsync,
      infoAsync: mocks.apiKeyInfoAsync,
      getAsync: mocks.apiKeyGetAsync,
    },
    ApiKeyType: { PUBLIC_API: "PUBLIC_API" },
    UserRole: { ADMIN: "ADMIN", APP_MANAGER: "APP_MANAGER" },
    // The SUT imports helpers from credentials-generator-apple-id, whose module-level
    // enum maps read these off the default import at load time.
    CertificateType: { IOS_DISTRIBUTION: "IOS_DISTRIBUTION", IOS_DEVELOPMENT: "IOS_DEVELOPMENT" },
    ProfileType: {
      IOS_APP_STORE: "IOS_APP_STORE",
      IOS_APP_ADHOC: "IOS_APP_ADHOC",
      IOS_APP_DEVELOPMENT: "IOS_APP_DEVELOPMENT",
      IOS_APP_INHOUSE: "IOS_APP_INHOUSE",
    },
    BundleIdPlatform: { IOS: "IOS" },
  };
  // Source code uses `import AppleUtils from "@expo/apple-utils"` (default import) because
  // the package is ncc-bundled CJS; mirror that so the default export is the flat namespace.
  return { ...mocked, default: mocked } as unknown as typeof AppleUtilsModule;
});

// ── helpers ─────────────────────────────────────────────────────

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

const buildApi = (vault: TestVault) =>
  ({
    me: { get: () => Effect.succeed({ activeOrganization: { id: "org-1" } }) },
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
    ascApiKeys: { upload: mocks.ascApiKeysUpload },
  }) as unknown as ApiClient;

const recordedWrites: { path: string; content: string }[] = [];
const fsStubLayer = Layer.succeed(FileSystem.FileSystem, {
  writeFileString: (path: string, content: string) =>
    Effect.sync(() => {
      recordedWrites.push({ path, content });
    }),
} as unknown as FileSystem.FileSystem);

/** CliRuntime surfacing the env identity so the vault unlocks without a passphrase. */
const vaultLayer = (privateKey: string) =>
  Layer.mergeAll(
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

const ascLayer = (privateKey: string) => Layer.mergeAll(vaultLayer(privateKey), fsStubLayer);

const context: RequestContext = { teamId: "TEAM1234", providerId: 100 };
const PEM = "-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMG\n-----END PRIVATE KEY-----\n";

const makeKey = () => ({
  id: "ASCKEY123",
  attributes: { nickname: "[better-update] x", roles: ["ADMIN"] },
  downloadAsync: mocks.apiKeyDownloadAsync,
});

const failureTag = (exit: Exit.Exit<unknown, unknown>): string | undefined => {
  if (!Exit.isFailure(exit)) {
    return undefined;
  }
  const json = exit.cause.toJSON() as { failure?: { _tag?: string } };
  return json.failure?._tag;
};

beforeEach(() => {
  vi.clearAllMocks();
  recordedWrites.length = 0;
});

// ── tests ──────────────────────────────────────────────────────

describe(generateAndUploadAscApiKeyViaAppleId, () => {
  it.effect("creates an ADMIN key, downloads it, and uploads only the sealed envelope", () =>
    Effect.gen(function* () {
      mocks.apiKeyCreateAsync.mockResolvedValue(makeKey());
      mocks.apiKeyDownloadAsync.mockResolvedValue(PEM);
      mocks.apiKeyInfoAsync.mockResolvedValue({
        id: "ASCKEY123",
        attributes: { provider: { id: "issuer-uuid-1" } },
      });
      mocks.ascApiKeysUpload.mockReturnValue(Effect.succeed({ id: "asc-local-1" }));

      const vault = yield* makeTestVault;
      const result = yield* generateAndUploadAscApiKeyViaAppleId(buildApi(vault), {
        context,
        appleTeamIdentifier: "TEAM1234",
        nickname: "[better-update] x",
        role: "ADMIN",
      }).pipe(Effect.provide(ascLayer(vault.identity.privateKey)));

      expect(result).toStrictEqual({
        id: "asc-local-1",
        keyId: "ASCKEY123",
        issuerId: "issuer-uuid-1",
        name: "ASCKEY123",
        role: "ADMIN",
      });
      // createAsync gets the EAS-shaped attributes.
      const [, createArgs] = mocks.apiKeyCreateAsync.mock.calls[0] as [
        unknown,
        { nickname: string; allAppsVisible: boolean; roles: string[]; keyType: string },
      ];
      expect(createArgs.allAppsVisible).toBe(true);
      expect(createArgs.keyType).toBe("PUBLIC_API");
      expect(createArgs.roles).toStrictEqual(["ADMIN"]);
      // E2E: the upload body carries the sealed envelope + public metadata, never the raw PEM.
      const [uploadArg] = mocks.ascApiKeysUpload.mock.calls[0] as [
        {
          payload: {
            keyId: string;
            issuerId: string;
            appleTeamIdentifier: string;
            roles: string[];
          };
        },
      ];
      expect(uploadArg.payload.keyId).toBe("ASCKEY123");
      expect(uploadArg.payload.issuerId).toBe("issuer-uuid-1");
      expect(uploadArg.payload.appleTeamIdentifier).toBe("TEAM1234");
      // The created role is persisted so the dashboard's Roles column is populated.
      expect(uploadArg.payload.roles).toStrictEqual(["ADMIN"]);
      expect(JSON.stringify(uploadArg.payload)).not.toContain("BEGIN PRIVATE KEY");
      expect(recordedWrites).toHaveLength(0);
    }),
  );

  it.effect("maps the APP_MANAGER role choice to UserRole.APP_MANAGER", () =>
    Effect.gen(function* () {
      mocks.apiKeyCreateAsync.mockResolvedValue(makeKey());
      mocks.apiKeyDownloadAsync.mockResolvedValue(PEM);
      mocks.apiKeyInfoAsync.mockResolvedValue({
        id: "ASCKEY123",
        attributes: { provider: { id: "issuer-uuid-1" } },
      });
      mocks.ascApiKeysUpload.mockReturnValue(Effect.succeed({ id: "asc-local-1" }));

      const vault = yield* makeTestVault;
      yield* generateAndUploadAscApiKeyViaAppleId(buildApi(vault), {
        context,
        appleTeamIdentifier: "TEAM1234",
        nickname: "n",
        role: "APP_MANAGER",
      }).pipe(Effect.provide(ascLayer(vault.identity.privateKey)));

      const [, createArgs] = mocks.apiKeyCreateAsync.mock.calls[0] as [
        unknown,
        { roles: string[] },
      ];
      expect(createArgs.roles).toStrictEqual(["APP_MANAGER"]);
    }),
  );

  it.effect("clamps a too-long nickname to Apple's 30-char API key name cap", () =>
    Effect.gen(function* () {
      mocks.apiKeyCreateAsync.mockResolvedValue(makeKey());
      mocks.apiKeyDownloadAsync.mockResolvedValue(PEM);
      mocks.apiKeyInfoAsync.mockResolvedValue({
        id: "ASCKEY123",
        attributes: { provider: { id: "issuer-uuid-1" } },
      });
      mocks.ascApiKeysUpload.mockReturnValue(Effect.succeed({ id: "asc-local-1" }));

      const vault = yield* makeTestVault;
      yield* generateAndUploadAscApiKeyViaAppleId(buildApi(vault), {
        context,
        appleTeamIdentifier: "TEAM1234",
        // 40 chars — the old ISO-timestamp default Apple rejected as "too long".
        nickname: "[better-update] 2026-06-29T23:15:42.123Z",
        role: "ADMIN",
      }).pipe(Effect.provide(ascLayer(vault.identity.privateKey)));

      const [, createArgs] = mocks.apiKeyCreateAsync.mock.calls[0] as [
        unknown,
        { nickname: string },
      ];
      expect(createArgs.nickname.length).toBeLessThanOrEqual(30);
      expect(createArgs.nickname).toMatch(/^\[better-update\] /u);
    }),
  );

  it.effect("fails fast (no retry) when the key has already been downloaded", () =>
    Effect.gen(function* () {
      mocks.apiKeyCreateAsync.mockResolvedValue(makeKey());
      mocks.apiKeyDownloadAsync.mockResolvedValue(null);

      const vault = yield* makeTestVault;
      const exit = yield* Effect.exit(
        generateAndUploadAscApiKeyViaAppleId(buildApi(vault), {
          context,
          appleTeamIdentifier: "TEAM1234",
          nickname: "n",
          role: "ADMIN",
        }),
      ).pipe(Effect.provide(ascLayer(vault.identity.privateKey)));

      expect(failureTag(exit)).toBe("AppleIdGenerateFailedError");
      expect(mocks.apiKeyDownloadAsync).toHaveBeenCalledTimes(1);
      // Nothing was downloaded, so there is nothing to rescue.
      expect(recordedWrites).toHaveLength(0);
    }),
  );

  it.effect("does not retry a non-propagation download error", () =>
    Effect.gen(function* () {
      mocks.apiKeyCreateAsync.mockResolvedValue(makeKey());
      mocks.apiKeyDownloadAsync.mockRejectedValue(new Error("network down"));

      const vault = yield* makeTestVault;
      const exit = yield* Effect.exit(
        generateAndUploadAscApiKeyViaAppleId(buildApi(vault), {
          context,
          appleTeamIdentifier: "TEAM1234",
          nickname: "n",
          role: "ADMIN",
        }),
      ).pipe(Effect.provide(ascLayer(vault.identity.privateKey)));

      expect(failureTag(exit)).toBe("AppleIdGenerateFailedError");
      expect(mocks.apiKeyDownloadAsync).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect("rescues the .p8 to disk when the issuer id cannot be resolved", () =>
    Effect.gen(function* () {
      mocks.apiKeyCreateAsync.mockResolvedValue(makeKey());
      mocks.apiKeyDownloadAsync.mockResolvedValue(PEM);
      // provider relationship missing → issuerId undefined → persist fails post-download.
      mocks.apiKeyInfoAsync.mockResolvedValue({ id: "ASCKEY123", attributes: {} });

      const vault = yield* makeTestVault;
      const exit = yield* Effect.exit(
        generateAndUploadAscApiKeyViaAppleId(buildApi(vault), {
          context,
          appleTeamIdentifier: "TEAM1234",
          nickname: "n",
          role: "ADMIN",
        }),
      ).pipe(Effect.provide(ascLayer(vault.identity.privateKey)));

      expect(failureTag(exit)).toBe("AppleIdGenerateFailedError");
      expect(recordedWrites).toHaveLength(1);
      expect(recordedWrites[0]?.path).toBe("AuthKey_ASCKEY123.p8");
      expect(recordedWrites[0]?.content).toContain("BEGIN PRIVATE KEY");
      expect(mocks.ascApiKeysUpload).not.toHaveBeenCalled();
    }),
  );
});

describe(defaultAscApiKeyNickname, () => {
  it("stays within Apple's 30-char API key name cap", () => {
    expect(defaultAscApiKeyNickname().length).toBeLessThanOrEqual(30);
    expect(defaultAscApiKeyNickname()).toMatch(/^\[better-update\] /u);
  });
});

describe(listAscApiKeysViaAppleId, () => {
  it.effect("returns only active team keys mapped to id + nickname", () =>
    Effect.gen(function* () {
      mocks.apiKeyGetAsync.mockResolvedValue([
        { id: "K1", attributes: { nickname: "ci admin", isActive: true } },
        { id: "K2", attributes: { nickname: "revoked", isActive: false } },
        { id: "K3", attributes: { nickname: "ci app-manager", isActive: true } },
      ]);

      const result = yield* listAscApiKeysViaAppleId(context);

      expect(result).toStrictEqual([
        { keyId: "K1", nickname: "ci admin" },
        { keyId: "K3", nickname: "ci app-manager" },
      ]);
    }),
  );
});
