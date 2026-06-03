import { randomUUID } from "node:crypto";

import {
  generateDek,
  generateIdentity,
  generateVaultKey,
  sealCredential,
  SCHEMA_VERSION,
  wrapDek,
  wrapVaultKey,
} from "@better-update/credentials-crypto";
import { toBase64 } from "@better-update/encoding";
import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Data, Effect, Exit, Layer } from "effect";

import type { Identity } from "@better-update/credentials-crypto";

import { CliRuntime } from "../services/cli-runtime";
import { IdentityStore } from "../services/identity-store";
import { pullEnvVars } from "./env-exporter";
import { EnvExportError } from "./exit-codes";
import { makeInteractiveModeLayer } from "./interactive-mode";
import { failureError } from "./test-utils";

import type { ApiClient } from "../services/api-client";
import type { SealedEnvVar } from "./env-exporter";

class TestApiError extends Data.TaggedError("TestApiError")<{ message: string }> {}

const ORG_ID = "org-1";
const VAULT_VERSION = 1;

interface TestVault {
  readonly identity: Identity;
  readonly vaultKey: Uint8Array;
  readonly wrappedVaultKey: string;
}

const makeTestVault = Effect.gen(function* () {
  const identity = yield* Effect.promise(async () => generateIdentity());
  const vaultKey = generateVaultKey();
  const wrappedVaultKey = toBase64(
    yield* Effect.promise(async () => wrapVaultKey({ vaultKey, recipient: identity.publicKey })),
  );
  return { identity, vaultKey, wrappedVaultKey } satisfies TestVault;
});

/** Seal an env var value the way the CLI does, returning the export-item envelope. */
const sealEnvVar = (
  vault: TestVault,
  args: {
    readonly key: string;
    readonly environment: "development" | "preview" | "production";
    readonly visibility: "plaintext" | "sensitive";
    readonly value: string;
  },
): SealedEnvVar => {
  const id = randomUUID();
  const dek = generateDek();
  const ciphertext = toBase64(
    sealCredential({
      dek,
      payload: {
        schemaVersion: SCHEMA_VERSION,
        orgId: ORG_ID,
        credentialId: id,
        credentialType: "envVarValue",
        metadata: { key: args.key, environment: args.environment },
        secret: { value: args.value },
      },
    }),
  );
  const wrappedDek = toBase64(
    wrapDek({
      dek,
      vaultKey: vault.vaultKey,
      binding: { orgId: ORG_ID, credentialId: id, vaultVersion: VAULT_VERSION },
    }),
  );
  return {
    key: args.key,
    environment: args.environment,
    visibility: args.visibility,
    id,
    ciphertext,
    wrappedDek,
    vaultVersion: VAULT_VERSION,
  };
};

const buildApi = (
  vault: TestVault,
  exportFn: (args: {
    urlParams: { projectId: string; environment: string };
  }) => Effect.Effect<{ environment: string; items: readonly SealedEnvVar[] }, unknown>,
): ApiClient =>
  ({
    me: { get: () => Effect.succeed({ activeOrganization: { id: ORG_ID } }) },
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
      getWrap: () =>
        Effect.succeed({ vaultVersion: VAULT_VERSION, wrappedKey: vault.wrappedVaultKey }),
    },
    "env-vars": { export: exportFn },
  }) as unknown as ApiClient;

/** CliRuntime that surfaces the env identity so the vault unlocks without a passphrase. */
const vaultLayer = (privateKey: string) =>
  Layer.mergeAll(
    NodeFileSystem.layer,
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

describe(pullEnvVars, () => {
  it.effect("decrypts sealed items into a Record<string,string>", () =>
    Effect.gen(function* () {
      const vault = yield* makeTestVault;
      const items = [
        sealEnvVar(vault, {
          key: "API_URL",
          environment: "production",
          visibility: "plaintext",
          value: "https://api.example.com",
        }),
        sealEnvVar(vault, {
          key: "SECRET",
          environment: "production",
          visibility: "sensitive",
          value: "xyz",
        }),
      ];
      const api = buildApi(vault, () => Effect.succeed({ environment: "production", items }));
      const result = yield* pullEnvVars(api, { projectId: "p_1", environment: "production" }).pipe(
        Effect.provide(vaultLayer(vault.identity.privateKey)),
      );
      expect(result).toStrictEqual({ API_URL: "https://api.example.com", SECRET: "xyz" });
    }),
  );

  it.effect("returns an empty object (no vault unlock) when there are no items", () =>
    Effect.gen(function* () {
      const vault = yield* makeTestVault;
      const api = buildApi(vault, () => Effect.succeed({ environment: "development", items: [] }));
      const result = yield* pullEnvVars(api, { projectId: "p_1", environment: "development" }).pipe(
        Effect.provide(vaultLayer(vault.identity.privateKey)),
      );
      expect(result).toStrictEqual({});
    }),
  );

  it.effect("wraps API errors as EnvExportError", () =>
    Effect.gen(function* () {
      const vault = yield* makeTestVault;
      const api = buildApi(vault, () => Effect.fail(new TestApiError({ message: "boom" })));
      const exit = yield* pullEnvVars(api, { projectId: "p_1", environment: "production" }).pipe(
        Effect.provide(vaultLayer(vault.identity.privateKey)),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(failureError(exit)).toBeInstanceOf(EnvExportError);
      }
    }),
  );

  it.effect("rejects an invalid environment", () =>
    Effect.gen(function* () {
      const vault = yield* makeTestVault;
      const api = buildApi(vault, () => Effect.succeed({ environment: "production", items: [] }));
      const exit = yield* pullEnvVars(api, { projectId: "p_1", environment: "bogus" }).pipe(
        Effect.provide(vaultLayer(vault.identity.privateKey)),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );
});
