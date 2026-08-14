import {
  generateIdentity,
  generateVaultKey,
  sealIdentity,
  wrapVaultKey,
} from "@better-update/credentials-crypto";
import { toBase64 } from "@better-update/encoding";
import { it } from "@effect/vitest";
import { Effect, Either, Layer } from "effect";

import type { IdentityFile } from "@better-update/credentials-crypto";

import { makeInteractiveModeLayer } from "../lib/interactive-mode";
import { CliRuntime } from "../services/cli-runtime";
import { DeviceUnlockMemoLive } from "../services/device-unlock-memo";
import { IdentityStore } from "../services/identity-store";
import { unlockEnvVaultKeyInteractive } from "./env-vault-access";
import { unlockVaultKeyInteractive } from "./vault-access";

import type { ApiClient } from "../services/api-client";

// ── module mocks ────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  promptPassword: vi.fn<() => string>(),
}));

vi.mock(import("../lib/prompts"), async (importOriginal) => ({
  ...(await importOriginal()),
  promptPassword: () => Effect.sync(() => mocks.promptPassword()),
}));

// ── fixtures ────────────────────────────────────────────────────

// Argon2id is deliberately expensive; tiny params keep the seal/open tests fast.
const fastKdf = { time: 1, memory: 256, parallelism: 1 };

const ORG_ID = "org_1";

interface Fixture {
  readonly file: IdentityFile;
  readonly credentialsVaultKey: Uint8Array;
  readonly envVaultKey: Uint8Array;
  readonly api: ApiClient;
}

const setup = Effect.gen(function* () {
  const identity = yield* Effect.promise(async () => generateIdentity());
  const file = yield* Effect.promise(async () =>
    sealIdentity({ privateKey: identity.privateKey, passphrase: "pw", kdfParams: fastKdf }),
  );
  const credentialsVaultKey = generateVaultKey();
  const envVaultKey = generateVaultKey();
  const [credentialsWrap, envWrap] = yield* Effect.promise(async () =>
    Promise.all([
      wrapVaultKey({ vaultKey: credentialsVaultKey, recipient: identity.publicKey }),
      wrapVaultKey({ vaultKey: envVaultKey, recipient: identity.publicKey }),
    ]),
  );
  const api = {
    userEncryptionKeys: {
      list: () =>
        Effect.succeed({
          items: [
            {
              id: "key-1",
              publicKey: identity.publicKey,
              fingerprint: identity.fingerprint,
              kind: "device",
              label: "laptop",
            },
          ],
        }),
    },
    orgVault: {
      getWrap: () => Effect.succeed({ vaultVersion: 3, wrappedKey: toBase64(credentialsWrap) }),
    },
    envVault: {
      getWrap: () => Effect.succeed({ envVaultVersion: 7, wrappedKey: toBase64(envWrap) }),
    },
  } as unknown as ApiClient;
  return { file, credentialsVaultKey, envVaultKey, api } satisfies Fixture;
});

/** No keychain in unit tests — `BETTER_UPDATE_NO_CACHE` leaves the in-process memo as the only reuse. */
const layers = (file: IdentityFile) =>
  Layer.mergeAll(
    Layer.succeed(CliRuntime, {
      argv: [],
      platform: "linux",
      cwd: Effect.succeed("/"),
      getEnv: (name: string) => Effect.succeed(name === "BETTER_UPDATE_NO_CACHE" ? "1" : undefined),
      homeDirectory: Effect.succeed("/"),
      userName: Effect.succeed("test"),
      commandEnvironment: () => Effect.succeed({}),
      setExitCode: () => Effect.void,
    }),
    Layer.succeed(IdentityStore, {
      load: Effect.sync(() => file),
      save: () => Effect.void,
      clear: Effect.void,
    }),
    makeInteractiveModeLayer(true),
    DeviceUnlockMemoLive,
  );

// ── tests ───────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("unlocking both org vaults in one command", () => {
  it.effect("prompts for the device passphrase once, not once per vault", () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      mocks.promptPassword.mockReturnValue("pw");
      const unlocked = yield* Effect.gen(function* () {
        const credentials = yield* unlockVaultKeyInteractive(fixture.api, { orgId: ORG_ID });
        const env = yield* unlockEnvVaultKeyInteractive(fixture.api, ORG_ID);
        return { credentials, env };
      }).pipe(Effect.provide(layers(fixture.file)));

      expect(mocks.promptPassword).toHaveBeenCalledTimes(1);
      expect(toBase64(unlocked.credentials.vaultKey)).toBe(toBase64(fixture.credentialsVaultKey));
      expect(toBase64(unlocked.env.vaultKey)).toBe(toBase64(fixture.envVaultKey));
    }),
  );

  it.effect("never remembers a passphrase that failed to open the identity", () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      mocks.promptPassword.mockReturnValueOnce("wrong").mockReturnValueOnce("pw");
      const attempts = yield* Effect.gen(function* () {
        const failed = yield* Effect.either(
          unlockVaultKeyInteractive(fixture.api, { orgId: ORG_ID }),
        );
        const recovered = yield* Effect.either(unlockEnvVaultKeyInteractive(fixture.api, ORG_ID));
        return { failed, recovered };
      }).pipe(Effect.provide(layers(fixture.file)));

      expect(Either.isLeft(attempts.failed)).toBe(true);
      expect(mocks.promptPassword).toHaveBeenCalledTimes(2);
      expect(Either.isRight(attempts.recovered)).toBe(true);
    }),
  );
});
