import { FileSystem } from "@effect/platform";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import type { Context } from "effect";

import { makeInteractiveModeLayer } from "../lib/interactive-mode";
import { makeOutputModeLayer } from "../lib/output-mode";
import { AppleAuth } from "../services/apple-auth";
import { CliRuntime } from "../services/cli-runtime";
import { IdentityStore } from "../services/identity-store";
import { ensureIosCredentials } from "./credentials-interactive";

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
    Layer.succeed(AppleAuth, "unused" as unknown as Context.Tag.Service<typeof AppleAuth>),
    Layer.succeed(CliRuntime, "unused" as unknown as Context.Tag.Service<typeof CliRuntime>),
    Layer.succeed(IdentityStore, "unused" as unknown as Context.Tag.Service<typeof IdentityStore>),
    Layer.succeed(FileSystem.FileSystem, "unused" as unknown as FileSystem.FileSystem),
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
        { path: { id: "config-1" }, payload: { appleProvisioningProfileId: "profile-new-1" } },
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
        { path: { id: "config-1" }, payload: { ascApiKeyId: "asc-key-1" } },
        { path: { id: "config-1" }, payload: { appleProvisioningProfileId: "profile-new-1" } },
      ]);
    }).pipe(Effect.provide(stubLayer(true))),
  );
});
