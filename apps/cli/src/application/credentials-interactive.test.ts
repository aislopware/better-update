import { it } from "@effect/vitest";
import { FileSystem, Effect, Layer } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import type { Context } from "effect";

import { makeInteractiveModeLayer } from "../lib/interactive-mode";
import { makeOutputModeLayer } from "../lib/output-mode";
import { AppleAuth } from "../services/apple-auth";
import { CliRuntime } from "../services/cli-runtime";
import { DeviceUnlockMemoLive } from "../services/device-unlock-memo";
import { IdentityStore } from "../services/identity-store";
import { ensureAndroidCredentials, ensureIosCredentials } from "./credentials-interactive";

// eslint-disable-next-line import-plugin/no-namespace -- vi.mock factory return must satisfy the full module namespace type
import type * as GeneratorModule from "../lib/credentials-generator-apple";
// eslint-disable-next-line import-plugin/no-namespace -- same reason
import type * as PromptsModule from "../lib/prompts";
import type { ApiClient } from "../services/api-client";
// eslint-disable-next-line import-plugin/no-namespace -- same reason
import type * as AppleIdModule from "./credentials-interactive-apple-id";

// ── module mocks ────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  promptSelect: vi.fn<(...args: unknown[]) => unknown>(),
  regenerateViaAppleId: vi.fn<(...args: unknown[]) => unknown>(),
  generateAndUpload: vi.fn<(...args: unknown[]) => unknown>(),
  ascKeyContext: vi.fn<(...args: unknown[]) => unknown>(),
}));

vi.mock(
  import("../lib/prompts"),
  () =>
    ({
      promptSelect: (...args: unknown[]) => mocks.promptSelect(...args),
    }) as unknown as typeof PromptsModule,
);

vi.mock(import("./credentials-interactive-apple-id"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    regenerateProvisioningProfileViaAppleId: (...args: unknown[]) =>
      Effect.sync(() => mocks.regenerateViaAppleId(...args)),
  } as unknown as typeof AppleIdModule;
});

vi.mock(import("../lib/credentials-generator-apple"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    ascKeyRequestContext: (...args: unknown[]) => Effect.sync(() => mocks.ascKeyContext(...args)),
    generateAndUploadProvisioningProfile: (...args: unknown[]) =>
      Effect.sync(() => mocks.generateAndUpload(...args)),
  } as unknown as typeof GeneratorModule;
});

// ── helpers ─────────────────────────────────────────────────────

const bundleConfig = {
  id: "config-1",
  bundleIdentifier: "com.example.app",
  distributionType: "AD_HOC",
  appleTeamId: "team-uuid-1",
  appleDistributionCertificateId: "cert-1",
  ascApiKeyId: null,
};

const ascKey = { id: "asc-key-1", name: "CI key", keyId: "ABC123", appleTeamId: "team-uuid-1" };

const buildApi = (resolveResult: { profileStale: boolean; ascApiKeyId: string | null }) => {
  const updates: unknown[] = [];
  const api = {
    buildCredentials: {
      resolve: () =>
        Effect.succeed({
          platform: "ios",
          profileStale: resolveResult.profileStale,
          context: {
            ascApiKeyId: resolveResult.ascApiKeyId,
            distributionCertificateId: "cert-1",
            appleTeamId: "team-uuid-1",
            appleTeamIdentifier: "TEAM1234",
          },
        }),
    },
    iosBundleConfigurations: {
      list: () => Effect.succeed({ items: [bundleConfig] }),
      update: (args: unknown) =>
        Effect.sync(() => {
          updates.push(args);
          return bundleConfig;
        }),
    },
    ascApiKeys: { list: () => Effect.succeed({ items: [ascKey] }) },
  } as unknown as ApiClient;
  return { api, updates };
};

const input = {
  projectId: "project-1",
  bundleIdentifier: "com.example.app",
  distribution: "ad-hoc",
} as Parameters<typeof ensureIosCredentials>[1];

/** See the sibling profile test: the mocked paths never touch these services. */
const stubLayer = (interactive: boolean) =>
  Layer.mergeAll(
    makeInteractiveModeLayer(interactive),
    makeOutputModeLayer(false),
    Layer.succeed(AppleAuth, "unused" as unknown as Context.Service.Shape<typeof AppleAuth>),
    Layer.succeed(CliRuntime, "unused" as unknown as Context.Service.Shape<typeof CliRuntime>),
    DeviceUnlockMemoLive,
    Layer.succeed(
      IdentityStore,
      "unused" as unknown as Context.Service.Shape<typeof IdentityStore>,
    ),
    Layer.succeed(
      FileSystem.FileSystem,
      "unused" as unknown as Context.Service.Shape<typeof FileSystem.FileSystem>,
    ),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.generateAndUpload.mockReturnValue({ id: "profile-new-1" });
  mocks.ascKeyContext.mockReturnValue({ teamId: "TEAM1234" });
});

// ── tests ───────────────────────────────────────────────────────

describe(ensureIosCredentials, () => {
  it.effect("refreshes a stale profile headless off the server-resolved ASC key", () =>
    Effect.gen(function* () {
      const { api, updates } = buildApi({ profileStale: true, ascApiKeyId: "asc-key-1" });

      yield* ensureIosCredentials(api, input, { freezeCredentials: true });

      expect(mocks.ascKeyContext).toHaveBeenCalledWith(expect.anything(), "asc-key-1");
      expect(mocks.promptSelect).not.toHaveBeenCalled();
      expect(mocks.regenerateViaAppleId).not.toHaveBeenCalled();
      expect(updates).toStrictEqual([
        { params: { id: "config-1" }, payload: { appleProvisioningProfileId: "profile-new-1" } },
      ]);
    }).pipe(Effect.provide(stubLayer(false))),
  );

  it.effect("fails when a stale profile has no ASC key to regenerate it headless", () =>
    Effect.gen(function* () {
      const { api } = buildApi({ profileStale: true, ascApiKeyId: null });

      const error = yield* Effect.flip(
        ensureIosCredentials(api, input, { freezeCredentials: true }),
      );

      expect(error._tag).toBe("MissingCredentialsError");
      expect(error.message).toContain("Stale provisioning profile");
      expect(mocks.generateAndUpload).not.toHaveBeenCalled();
    }).pipe(Effect.provide(stubLayer(false))),
  );

  it.effect("leaves a fresh profile alone", () =>
    Effect.gen(function* () {
      const { api, updates } = buildApi({ profileStale: false, ascApiKeyId: null });

      yield* ensureIosCredentials(api, input, { freezeCredentials: true });

      expect(mocks.generateAndUpload).not.toHaveBeenCalled();
      expect(updates).toStrictEqual([]);
    }).pipe(Effect.provide(stubLayer(false))),
  );

  it.effect("still offers to bind the key when the run can prompt", () =>
    Effect.gen(function* () {
      mocks.promptSelect.mockReturnValue(Effect.succeed("asc-key-1"));
      const { api, updates } = buildApi({ profileStale: true, ascApiKeyId: "asc-key-1" });

      yield* ensureIosCredentials(api, input, { freezeCredentials: false });

      expect(mocks.promptSelect).toHaveBeenCalledTimes(1);
      // Binding the key persists, so later runs (and CI) skip the offer entirely.
      expect(updates).toStrictEqual([
        { params: { id: "config-1" }, payload: { ascApiKeyId: "asc-key-1" } },
        { params: { id: "config-1" }, payload: { appleProvisioningProfileId: "profile-new-1" } },
      ]);
    }).pipe(Effect.provide(stubLayer(true))),
  );
});

// ── Android resolve-error classification ─────────────────────────
//
// `ensureAndroidCredentials` only reaches first-run setup when it recognises
// the resolve failure as "not configured yet". A server that reshapes its
// error bodies makes the client report an undecodable `HttpClientError`
// instead of a tagged `NotFound`, which used to slip past the guard and leave
// no way to configure Android credentials at all (BU-38).

const androidInput = {
  projectId: "project-1",
  applicationIdentifier: "com.example.app",
};

const failingAndroidApi = (error: unknown) =>
  ({ buildCredentials: { resolve: () => Effect.fail(error) } }) as unknown as ApiClient;

/** Freeze mode never reaches keystore generation, so the spawner is unused. */
const androidStubLayer = Layer.merge(
  stubLayer(false),
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    "unused" as unknown as Context.Service.Shape<typeof ChildProcessSpawner.ChildProcessSpawner>,
  ),
);

const statusCodeError = (status: number) => ({
  _tag: "HttpClientError",
  reason: { _tag: "StatusCodeError", response: { status } },
});

describe(ensureAndroidCredentials, () => {
  it.effect.each([
    ["tagged NotFound", { _tag: "NotFound", message: "no android app id" }],
    ["tagged BadRequest", { _tag: "BadRequest", message: "bad request" }],
    ["undecodable 404", statusCodeError(404)],
    ["undecodable 400", statusCodeError(400)],
  ])("treats %s as missing credentials", ([, cause]) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        ensureAndroidCredentials(failingAndroidApi(cause), androidInput, {
          freezeCredentials: true,
        }),
      );

      expect(error._tag).toBe("MissingCredentialsError");
    }).pipe(Effect.provide(androidStubLayer)),
  );

  it.effect("leaves an unrelated failure alone", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        ensureAndroidCredentials(failingAndroidApi(statusCodeError(500)), androidInput, {
          freezeCredentials: true,
        }),
      );

      expect(error._tag).toBe("HttpClientError");
    }).pipe(Effect.provide(androidStubLayer)),
  );
});
