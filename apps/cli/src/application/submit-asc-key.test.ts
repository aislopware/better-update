import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { makeInteractiveModeLayer } from "../lib/interactive-mode";
import { makeOutputModeLayer } from "../lib/output-mode";
import { AppleAuth } from "../services/apple-auth";
import { ensureAscApiKeyForSubmit } from "./submit-asc-key";

// eslint-disable-next-line import-plugin/no-namespace -- vi.mock factory return must satisfy the full module namespace type
import type * as AscKeyGenModule from "../lib/credentials-generator-asc-key";
// eslint-disable-next-line import-plugin/no-namespace -- vi.mock factory return must satisfy the full module namespace type
import type * as EasJsonModule from "../lib/eas-json";
import type { InteractiveMode } from "../lib/interactive-mode";
import type { OutputMode } from "../lib/output-mode";
// eslint-disable-next-line import-plugin/no-namespace -- vi.mock factory return must satisfy the full module namespace type
import type * as PromptsModule from "../lib/prompts";
import type { ApiClient } from "../services/api-client";

// ── module mocks ────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  promptConfirm: vi.fn<(...args: unknown[]) => unknown>(),
  promptSelect: vi.fn<(...args: unknown[]) => unknown>(),
  generate: vi.fn<(...args: unknown[]) => unknown>(),
  listTeamKeys: vi.fn<(...args: unknown[]) => unknown>(),
  setSubmit: vi.fn<(...args: unknown[]) => unknown>(),
  ascApiKeysList: vi.fn<() => unknown>(),
}));

vi.mock(
  import("../lib/prompts"),
  () =>
    ({
      promptConfirm: (...args: unknown[]) => mocks.promptConfirm(...args),
      promptSelect: (...args: unknown[]) => mocks.promptSelect(...args),
    }) as unknown as typeof PromptsModule,
);

vi.mock(
  import("../lib/credentials-generator-asc-key"),
  () =>
    ({
      generateAndUploadAscApiKeyViaAppleId: (...args: unknown[]) => mocks.generate(...args),
      listAscApiKeysViaAppleId: (...args: unknown[]) => mocks.listTeamKeys(...args),
      defaultAscApiKeyNickname: () => "[better-update] test",
    }) as unknown as typeof AscKeyGenModule,
);

vi.mock(
  import("../lib/eas-json"),
  () =>
    ({
      setSubmitProfileAscApiKeyId: (...args: unknown[]) => mocks.setSubmit(...args),
    }) as unknown as typeof EasJsonModule,
);

// ── harness ─────────────────────────────────────────────────────

const appleAuthStub = Layer.succeed(AppleAuth, {
  ensureLoggedIn: () =>
    Effect.succeed({ username: "u@acme.com", teamId: "TEAM1234", teamName: "Acme", providerId: 1 }),
  buildRequestContext: () => ({ teamId: "TEAM1234", providerId: 1 }),
  logout: Effect.void,
  whoami: Effect.succeed(null),
} as unknown as typeof AppleAuth.Service);

const api = { ascApiKeys: { list: () => mocks.ascApiKeysList() } } as unknown as ApiClient;

const run = (interactive: boolean) =>
  // The mocked generator + eas-json never touch FileSystem/CliRuntime/IdentityStore at
  // runtime, but the real function type still lists them — cast them out of the requirement
  // set so only the services the mocks exercise need providing.
  (
    ensureAscApiKeyForSubmit({
      api,
      projectRoot: "/proj",
      profileName: "production",
    }) as Effect.Effect<string | null, never, AppleAuth | InteractiveMode | OutputMode>
  ).pipe(
    Effect.provide(
      Layer.mergeAll(
        appleAuthStub,
        makeInteractiveModeLayer(interactive),
        makeOutputModeLayer(false),
      ),
    ),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setSubmit.mockReturnValue(Effect.succeed("/proj/eas.json"));
});

// ── tests ───────────────────────────────────────────────────────

describe(ensureAscApiKeyForSubmit, () => {
  it.effect("returns null without touching anything in non-interactive mode", () =>
    Effect.gen(function* () {
      const result = yield* run(false);
      expect(result).toBeNull();
      expect(mocks.ascApiKeysList).not.toHaveBeenCalled();
      expect(mocks.generate).not.toHaveBeenCalled();
    }),
  );

  it.effect("reuses the single stored vault key and persists it to eas.json", () =>
    Effect.gen(function* () {
      mocks.ascApiKeysList.mockReturnValue(
        Effect.succeed({ items: [{ id: "vault-1", name: "My Key", keyId: "K1" }] }),
      );

      const result = yield* run(true);

      expect(result).toBe("vault-1");
      expect(mocks.setSubmit).toHaveBeenCalledWith("/proj", "production", "vault-1");
      expect(mocks.generate).not.toHaveBeenCalled();
      expect(mocks.promptConfirm).not.toHaveBeenCalled();
      expect(mocks.promptSelect).not.toHaveBeenCalled();
    }),
  );

  it.effect("creates a key when vault + team are empty and the user confirms", () =>
    Effect.gen(function* () {
      mocks.ascApiKeysList.mockReturnValue(Effect.succeed({ items: [] }));
      mocks.listTeamKeys.mockReturnValue(Effect.succeed([]));
      mocks.promptConfirm.mockReturnValue(Effect.succeed(true));
      mocks.promptSelect.mockReturnValue(Effect.succeed("ADMIN"));
      mocks.generate.mockReturnValue(
        Effect.succeed({ id: "new-1", keyId: "NK1", issuerId: "iss", name: "NK1", role: "ADMIN" }),
      );

      const result = yield* run(true);

      expect(result).toBe("new-1");
      expect(mocks.generate).toHaveBeenCalledTimes(1);
      const [, genArgs] = mocks.generate.mock.calls[0] as [unknown, { role: string }];
      expect(genArgs.role).toBe("ADMIN");
      expect(mocks.setSubmit).toHaveBeenCalledWith("/proj", "production", "new-1");
    }),
  );

  it.effect("does not create when the team already has keys and the user declines", () =>
    Effect.gen(function* () {
      mocks.ascApiKeysList.mockReturnValue(Effect.succeed({ items: [] }));
      mocks.listTeamKeys.mockReturnValue(
        Effect.succeed([{ keyId: "EXISTING", nickname: "team key" }]),
      );
      mocks.promptConfirm.mockReturnValue(Effect.succeed(false));

      const result = yield* run(true);

      expect(result).toBeNull();
      expect(mocks.generate).not.toHaveBeenCalled();
    }),
  );
});
