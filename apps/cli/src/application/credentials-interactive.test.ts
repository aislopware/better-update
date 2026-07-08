import { FileSystem } from "@effect/platform";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import type { Context } from "effect";

import { makeInteractiveModeLayer } from "../lib/interactive-mode";
import { makeOutputModeLayer } from "../lib/output-mode";
import { AppleAuth } from "../services/apple-auth";
import { CliRuntime } from "../services/cli-runtime";
import { IdentityStore } from "../services/identity-store";
import { regenerateProvisioningProfile } from "./credentials-interactive";

// eslint-disable-next-line import-plugin/no-namespace -- same reason
import type * as GeneratorModule from "../lib/credentials-generator-apple";
// eslint-disable-next-line import-plugin/no-namespace -- same reason
import type * as PromptsModule from "../lib/prompts";
import type { ApiClient } from "../services/api-client";
// eslint-disable-next-line import-plugin/no-namespace -- vi.mock factory return must satisfy the full module namespace type
import type * as AppleIdModule from "./credentials-interactive-apple-id";

// ── module mocks ────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  promptSelect: vi.fn<(...args: unknown[]) => unknown>(),
  regenerateViaAppleId: vi.fn<(...args: unknown[]) => unknown>(),
  generateAndUpload: vi.fn<(...args: unknown[]) => unknown>(),
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
    ascKeyRequestContext: () => Effect.succeed({ teamId: "TEAM1234" }),
    generateAndUploadProvisioningProfile: (...args: unknown[]) =>
      Effect.sync(() => mocks.generateAndUpload(...args)),
  } as unknown as typeof GeneratorModule;
});

// ── helpers ─────────────────────────────────────────────────────

const bundleConfig = (ascApiKeyId: string | null) => ({
  id: "config-1",
  bundleIdentifier: "com.example.app",
  distributionType: "AD_HOC",
  appleTeamId: "team-uuid-1",
  appleDistributionCertificateId: "cert-1",
  ascApiKeyId,
});

const ascKey = { id: "asc-key-1", name: "CI key", keyId: "ABC123", appleTeamId: "team-uuid-1" };

const buildApi = (config: ReturnType<typeof bundleConfig>, ascKeys: (typeof ascKey)[]) => {
  const updates: unknown[] = [];
  const api = {
    iosBundleConfigurations: {
      list: () => Effect.succeed({ items: [config] }),
      update: (args: unknown) =>
        Effect.sync(() => {
          updates.push(args);
          return config;
        }),
    },
    ascApiKeys: { list: () => Effect.succeed({ items: ascKeys }) },
  } as unknown as ApiClient;
  return { api, updates };
};

const input = {
  projectId: "project-1",
  bundleIdentifier: "com.example.app",
  distribution: "ad-hoc",
} as Parameters<typeof regenerateProvisioningProfile>[1];

/**
 * The SUT's TYPE still requires AppleAuth/CliRuntime/IdentityStore (vi.mock
 * swaps the runtime, not the signature); the mocked paths never touch these,
 * so inert stubs satisfy the checker.
 */
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
});

// ── tests ───────────────────────────────────────────────────────

describe(regenerateProvisioningProfile, () => {
  it.effect("offers to bind a team ASC key and regenerates headless after binding", () =>
    Effect.gen(function* () {
      mocks.promptSelect.mockReturnValue(Effect.succeed("asc-key-1"));
      const { api, updates } = buildApi(bundleConfig(null), [ascKey]);

      const created = yield* regenerateProvisioningProfile(api, input);

      expect(created).toStrictEqual({ id: "profile-new-1" });
      expect(mocks.regenerateViaAppleId).not.toHaveBeenCalled();
      // First update binds the key, second binds the fresh profile.
      expect(updates).toStrictEqual([
        { path: { id: "config-1" }, payload: { ascApiKeyId: "asc-key-1" } },
        { path: { id: "config-1" }, payload: { appleProvisioningProfileId: "profile-new-1" } },
      ]);
    }).pipe(Effect.provide(stubLayer(true))),
  );

  it.effect("falls back to Apple ID when the user declines the binding", () =>
    Effect.gen(function* () {
      mocks.promptSelect.mockReturnValue(Effect.succeed("__apple-id__"));
      mocks.regenerateViaAppleId.mockReturnValue({ id: "profile-apple-id" });
      const { api, updates } = buildApi(bundleConfig(null), [ascKey]);

      yield* regenerateProvisioningProfile(api, input);

      expect(mocks.regenerateViaAppleId).toHaveBeenCalledTimes(1);
      expect(updates).toStrictEqual([]);
    }).pipe(Effect.provide(stubLayer(true))),
  );

  it.effect("never prompts when no ASC key exists for the config's team", () =>
    Effect.gen(function* () {
      mocks.regenerateViaAppleId.mockReturnValue({ id: "profile-apple-id" });
      const { api } = buildApi(bundleConfig(null), [
        { ...ascKey, id: "other", appleTeamId: "team-uuid-OTHER" },
      ]);

      yield* regenerateProvisioningProfile(api, input);

      expect(mocks.promptSelect).not.toHaveBeenCalled();
      expect(mocks.regenerateViaAppleId).toHaveBeenCalledTimes(1);
    }).pipe(Effect.provide(stubLayer(true))),
  );

  it.effect("never prompts in non-interactive mode", () =>
    Effect.gen(function* () {
      mocks.regenerateViaAppleId.mockReturnValue({ id: "profile-apple-id" });
      const { api } = buildApi(bundleConfig(null), [ascKey]);

      yield* regenerateProvisioningProfile(api, input);

      expect(mocks.promptSelect).not.toHaveBeenCalled();
      expect(mocks.regenerateViaAppleId).toHaveBeenCalledTimes(1);
    }).pipe(Effect.provide(stubLayer(false))),
  );

  it.effect("skips the offer entirely when the config already has an ASC key", () =>
    Effect.gen(function* () {
      const { api, updates } = buildApi(bundleConfig("asc-key-1"), [ascKey]);

      const created = yield* regenerateProvisioningProfile(api, input);

      expect(created).toStrictEqual({ id: "profile-new-1" });
      expect(mocks.promptSelect).not.toHaveBeenCalled();
      expect(updates).toStrictEqual([
        { path: { id: "config-1" }, payload: { appleProvisioningProfileId: "profile-new-1" } },
      ]);
    }).pipe(Effect.provide(stubLayer(true))),
  );
});
