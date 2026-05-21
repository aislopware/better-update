import { NotFound } from "@better-update/api";
import {
  generateIdentity,
  generateVaultKey,
  sealIdentity,
  unwrapVaultKey,
  wrapVaultKey,
} from "@better-update/credentials-crypto";
import { fromBase64, toBase64 } from "@better-update/encoding";
import { it } from "@effect/vitest";
import { Effect, Either, Layer } from "effect";

import type { UserEncryptionKey } from "@better-update/api";
import type { IdentityFile } from "@better-update/credentials-crypto";

import { CliRuntime } from "../services/cli-runtime";
import { IdentityStore } from "../services/identity-store";
import {
  findRecipient,
  grantRecipient,
  unlockActivePrivateKey,
  unlockVaultKey,
} from "./vault-access";

import type { ApiClient } from "../services/api-client";

// Argon2id is deliberately expensive; tiny params keep the seal/open tests fast.
const fastKdf = { time: 1, memory: 256, parallelism: 1 };

interface StubKey {
  readonly id: string;
  readonly publicKey: string;
  readonly fingerprint: string;
  readonly kind: string;
  readonly label: string;
}

interface AddWrapPayload {
  readonly vaultVersion: number;
  readonly wrap: { readonly userEncryptionKeyId: string; readonly wrappedKey: string };
}

interface ApiStub {
  readonly keys: readonly StubKey[];
  readonly wrap?: { readonly vaultVersion: number; readonly wrappedKey: string };
  /** Present => `orgVault.get()` succeeds (the org vault exists); absent => NotFound. */
  readonly vault?: { readonly vaultVersion: number };
  readonly captured?: AddWrapPayload[];
}

const buildApi = (stub: ApiStub): ApiClient =>
  ({
    userEncryptionKeys: {
      list: () => Effect.succeed({ items: stub.keys }),
    },
    orgVault: {
      get: () =>
        stub.vault
          ? Effect.succeed(stub.vault)
          : Effect.fail(new NotFound({ message: "Vault not initialized" })),
      getWrap: () =>
        stub.wrap
          ? Effect.succeed(stub.wrap)
          : Effect.fail(new NotFound({ message: "No vault key wrap for this recipient" })),
      addWrap: ({ payload }: { readonly payload: AddWrapPayload }) => {
        stub.captured?.push(payload);
        return Effect.succeed({});
      },
    },
  }) as unknown as ApiClient;

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

const identityStoreStub = (initial: IdentityFile | null) =>
  Layer.succeed(IdentityStore, {
    load: Effect.sync(() => initial),
    save: () => Effect.void,
    clear: Effect.void,
  });

describe("unlocking the active private key", () => {
  it.effect("returns the BETTER_UPDATE_IDENTITY env key without a passphrase", () =>
    Effect.gen(function* () {
      const identity = yield* Effect.promise(async () => generateIdentity());
      const result = yield* unlockActivePrivateKey(undefined).pipe(
        Effect.provide(
          Layer.mergeAll(
            cliRuntimeStub({ BETTER_UPDATE_IDENTITY: identity.privateKey }),
            identityStoreStub(null),
          ),
        ),
      );
      expect(result).toBe(identity.privateKey);
    }),
  );

  it.effect("opens the on-disk identity with the correct passphrase", () =>
    Effect.gen(function* () {
      const identity = yield* Effect.promise(async () => generateIdentity());
      const file = yield* Effect.promise(async () =>
        sealIdentity({ privateKey: identity.privateKey, passphrase: "pw", kdfParams: fastKdf }),
      );
      const result = yield* unlockActivePrivateKey("pw").pipe(
        Effect.provide(Layer.mergeAll(cliRuntimeStub({}), identityStoreStub(file))),
      );
      expect(result).toBe(identity.privateKey);
    }),
  );

  it.effect("fails without a passphrase for an on-disk identity", () =>
    Effect.gen(function* () {
      const identity = yield* Effect.promise(async () => generateIdentity());
      const file = yield* Effect.promise(async () =>
        sealIdentity({ privateKey: identity.privateKey, passphrase: "pw", kdfParams: fastKdf }),
      );
      const result = yield* Effect.either(
        unlockActivePrivateKey(undefined).pipe(
          Effect.provide(Layer.mergeAll(cliRuntimeStub({}), identityStoreStub(file))),
        ),
      );
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("IdentityError");
      }
    }),
  );

  it.effect("fails on a wrong passphrase", () =>
    Effect.gen(function* () {
      const identity = yield* Effect.promise(async () => generateIdentity());
      const file = yield* Effect.promise(async () =>
        sealIdentity({ privateKey: identity.privateKey, passphrase: "pw", kdfParams: fastKdf }),
      );
      const result = yield* Effect.either(
        unlockActivePrivateKey("wrong").pipe(
          Effect.provide(Layer.mergeAll(cliRuntimeStub({}), identityStoreStub(file))),
        ),
      );
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("IdentityError");
      }
    }),
  );
});

describe("unlocking the vault key", () => {
  it.effect("unwraps the vault key for the active recipient", () =>
    Effect.gen(function* () {
      const identity = yield* Effect.promise(async () => generateIdentity());
      const vaultKey = generateVaultKey();
      const wrapped = yield* Effect.promise(async () =>
        wrapVaultKey({ vaultKey, recipient: identity.publicKey }),
      );
      const api = buildApi({
        keys: [
          {
            id: "key-1",
            publicKey: identity.publicKey,
            fingerprint: identity.fingerprint,
            kind: "device",
            label: "laptop",
          },
        ],
        wrap: { vaultVersion: 4, wrappedKey: toBase64(wrapped) },
      });
      const result = yield* unlockVaultKey(api, undefined).pipe(
        Effect.provide(
          Layer.mergeAll(
            cliRuntimeStub({ BETTER_UPDATE_IDENTITY: identity.privateKey }),
            identityStoreStub(null),
          ),
        ),
      );
      expect(result.vaultVersion).toBe(4);
      expect(result.keyId).toBe("key-1");
      expect(result.vaultKey).toStrictEqual(vaultKey);
    }),
  );

  it.effect("fails when this device's key is not registered", () =>
    Effect.gen(function* () {
      const identity = yield* Effect.promise(async () => generateIdentity());
      const other = yield* Effect.promise(async () => generateIdentity());
      const api = buildApi({
        keys: [
          {
            id: "key-other",
            publicKey: other.publicKey,
            fingerprint: other.fingerprint,
            kind: "device",
            label: "someone else",
          },
        ],
      });
      const result = yield* Effect.either(
        unlockVaultKey(api, undefined).pipe(
          Effect.provide(
            Layer.mergeAll(
              cliRuntimeStub({ BETTER_UPDATE_IDENTITY: identity.privateKey }),
              identityStoreStub(null),
            ),
          ),
        ),
      );
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("IdentityError");
      }
    }),
  );

  it.effect("guides to `identity init` when the org has no vault yet", () =>
    Effect.gen(function* () {
      const identity = yield* Effect.promise(async () => generateIdentity());
      // Registered device, but no wrap AND no vault => fresh org, must bootstrap.
      const api = buildApi({
        keys: [
          {
            id: "key-1",
            publicKey: identity.publicKey,
            fingerprint: identity.fingerprint,
            kind: "device",
            label: "laptop",
          },
        ],
      });
      const result = yield* Effect.either(
        unlockVaultKey(api, undefined).pipe(
          Effect.provide(
            Layer.mergeAll(
              cliRuntimeStub({ BETTER_UPDATE_IDENTITY: identity.privateKey }),
              identityStoreStub(null),
            ),
          ),
        ),
      );
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result) && result.left._tag === "IdentityError") {
        expect(result.left.message).toContain("identity init");
      } else {
        expect.unreachable("expected an IdentityError pointing at `identity init`");
      }
    }),
  );

  it.effect("guides to request access when a vault exists but this device isn't a recipient", () =>
    Effect.gen(function* () {
      const identity = yield* Effect.promise(async () => generateIdentity());
      // Registered device, vault exists, but no wrap for this device => needs a grant.
      const api = buildApi({
        keys: [
          {
            id: "key-1",
            publicKey: identity.publicKey,
            fingerprint: identity.fingerprint,
            kind: "device",
            label: "laptop",
          },
        ],
        vault: { vaultVersion: 2 },
      });
      const result = yield* Effect.either(
        unlockVaultKey(api, undefined).pipe(
          Effect.provide(
            Layer.mergeAll(
              cliRuntimeStub({ BETTER_UPDATE_IDENTITY: identity.privateKey }),
              identityStoreStub(null),
            ),
          ),
        ),
      );
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result) && result.left._tag === "IdentityError") {
        expect(result.left.message).toContain("access grant");
      } else {
        expect.unreachable("expected an IdentityError pointing at a grant");
      }
    }),
  );
});

describe("granting a recipient", () => {
  it.effect("wraps the vault key to the target so the target can open it", () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(async () => generateIdentity());
      const vaultKey = generateVaultKey();
      const captured: AddWrapPayload[] = [];
      const api = buildApi({ keys: [], captured });
      const targetKey = {
        id: "tgt-1",
        publicKey: target.publicKey,
        fingerprint: target.fingerprint,
        kind: "device",
        label: "ci",
      } as unknown as UserEncryptionKey;

      yield* grantRecipient({
        api,
        vault: { vaultKey, vaultVersion: 7, keyId: "self" },
        target: targetKey,
      });

      expect(captured).toHaveLength(1);
      const [payload] = captured;
      expect(payload?.vaultVersion).toBe(7);
      expect(payload?.wrap.userEncryptionKeyId).toBe("tgt-1");
      const unwrapped = yield* Effect.promise(async () =>
        unwrapVaultKey({
          wrapped: fromBase64(payload?.wrap.wrappedKey ?? ""),
          privateKey: target.privateKey,
        }),
      );
      expect(unwrapped).toStrictEqual(vaultKey);
    }),
  );
});

describe("finding a recipient", () => {
  const keys: readonly StubKey[] = [
    { id: "k1", publicKey: "age1aaa", fingerprint: "SHA256:aaa", kind: "device", label: "a" },
    { id: "k2", publicKey: "age1bbb", fingerprint: "SHA256:bbb", kind: "machine", label: "b" },
  ];

  it.effect("matches by key id", () =>
    Effect.gen(function* () {
      const result = yield* findRecipient(buildApi({ keys }), "k2");
      expect(result.id).toBe("k2");
    }),
  );

  it.effect("matches by fingerprint", () =>
    Effect.gen(function* () {
      const result = yield* findRecipient(buildApi({ keys }), "SHA256:aaa");
      expect(result.id).toBe("k1");
    }),
  );

  it.effect("fails when nothing matches", () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(findRecipient(buildApi({ keys }), "nope"));
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("IdentityError");
      }
    }),
  );
});
