import { generateIdentity } from "@better-update/credentials-crypto";
import { it } from "@effect/vitest";
import { Effect, Either, Layer } from "effect";

import type { IdentityFile } from "@better-update/credentials-crypto";

import { CliRuntime } from "../services/cli-runtime";
import { IdentityStore } from "../services/identity-store";
import { activeRecipient, createLocalIdentity } from "./identity";

const FIXTURE_FILE: IdentityFile = {
  version: 1,
  publicKey: "age1fixturepublicrecipientkeyvalueforunittests",
  fingerprint: "SHA256:fixture",
  kdf: "argon2id",
  kdfParams: { time: 3, memory: 65_536, parallelism: 1 },
  salt: "c2FsdA==",
  cipher: "xchacha20poly1305",
  ct: "Y2lwaGVydGV4dA==",
};

const cliRuntimeStub = (env: Readonly<Record<string, string | undefined>>) =>
  Layer.succeed(CliRuntime, {
    argv: [],
    platform: "linux" as NodeJS.Platform,
    cwd: Effect.succeed("/"),
    getEnv: (name: string) => Effect.succeed(env[name]),
    homeDirectory: Effect.succeed("/"),
    userName: Effect.succeed("test"),
    commandEnvironment: () => Effect.succeed({}),
    setExitCode: () => Effect.void,
  });

const identityStoreStub = (initial: IdentityFile | null) => {
  const saved: IdentityFile[] = [];
  let current = initial;
  return {
    saved: () => saved,
    layer: Layer.succeed(IdentityStore, {
      load: Effect.sync(() => current),
      save: (file: IdentityFile) =>
        Effect.sync(() => {
          current = file;
          saved.push(file);
        }),
      clear: Effect.sync(() => {
        current = null;
      }),
    }),
  };
};

describe("active recipient resolution", () => {
  it.effect("prefers BETTER_UPDATE_IDENTITY over the on-disk identity", () =>
    Effect.gen(function* () {
      const identity = yield* Effect.promise(async () => generateIdentity());
      const result = yield* activeRecipient.pipe(
        Effect.provide(
          Layer.mergeAll(
            cliRuntimeStub({ BETTER_UPDATE_IDENTITY: identity.privateKey }),
            identityStoreStub(FIXTURE_FILE).layer,
          ),
        ),
      );
      expect(result.source).toBe("env");
      expect(result.publicKey).toBe(identity.publicKey);
    }),
  );

  it.effect("falls back to the on-disk identity when no env key is set", () =>
    Effect.gen(function* () {
      const result = yield* activeRecipient.pipe(
        Effect.provide(Layer.mergeAll(cliRuntimeStub({}), identityStoreStub(FIXTURE_FILE).layer)),
      );
      expect(result.source).toBe("file");
      expect(result.publicKey).toBe(FIXTURE_FILE.publicKey);
    }),
  );

  it.effect("fails when neither an env key nor an on-disk identity exists", () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(
        activeRecipient.pipe(
          Effect.provide(Layer.mergeAll(cliRuntimeStub({}), identityStoreStub(null).layer)),
        ),
      );
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("IdentityError");
      }
    }),
  );
});

describe("creating a local identity", () => {
  it.effect("refuses to overwrite an existing identity", () =>
    Effect.gen(function* () {
      const store = identityStoreStub(FIXTURE_FILE);
      const result = yield* Effect.either(
        createLocalIdentity("passphrase").pipe(Effect.provide(store.layer)),
      );
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("IdentityError");
      }
      expect(store.saved()).toHaveLength(0);
    }),
  );

  it.effect("generates and persists a sealed identity when none exists", () =>
    Effect.gen(function* () {
      const store = identityStoreStub(null);
      const identity = yield* createLocalIdentity("correct horse battery staple").pipe(
        Effect.provide(store.layer),
      );
      expect(identity.publicKey.startsWith("age1")).toBe(true);
      const saved = store.saved();
      expect(saved).toHaveLength(1);
      expect(saved[0]?.version).toBe(1);
      expect(saved[0]?.publicKey).toBe(identity.publicKey);
    }),
  );
});
