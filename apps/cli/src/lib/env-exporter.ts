import { Effect } from "effect";

import {
  openFromDownload,
  openVaultSessionInteractive,
  sealForUpload,
} from "../application/credential-cipher";
import { requireSecretString } from "./credential-secret";
import { EnvExportError } from "./exit-codes";

import type { VaultSession } from "../application/credential-cipher";
import type { ApiClient } from "../services/api-client";

type EnvironmentName = "development" | "preview" | "production";

/**
 * A sealed env var as the export endpoint returns it: the opaque value envelope
 * (`id` = the AAD credentialId) plus the plaintext metadata the CLI re-checks on
 * decrypt. Values are end-to-end encrypted; only the CLI (holding the org vault
 * key) can decrypt them. The index signature keeps it assignable to
 * `openFromDownload`'s `CredentialEnvelope & Record<string, unknown>`.
 */
export interface SealedEnvVar {
  readonly key: string;
  readonly environment: EnvironmentName;
  readonly visibility: "plaintext" | "sensitive";
  readonly id: string;
  readonly ciphertext: string;
  readonly wrappedDek: string;
  readonly vaultVersion: number;
  readonly [extra: string]: unknown;
}

export interface DecryptedEnvVar {
  readonly key: string;
  readonly value: string;
  readonly visibility: "plaintext" | "sensitive";
}

const coerceEnvironment = (raw: string): EnvironmentName | undefined =>
  raw === "development" || raw === "preview" || raw === "production" ? raw : undefined;

/** Decrypt one sealed env var value, re-checking the sealed metadata against the row. */
export const decryptEnvVarValue = (
  session: VaultSession,
  item: SealedEnvVar,
): Effect.Effect<string, EnvExportError> =>
  openFromDownload({ session, credentialType: "envVarValue", downloaded: item }).pipe(
    Effect.mapError(
      (cause) =>
        new EnvExportError({
          message: `Failed to decrypt env var "${item.key}": ${cause.message}`,
        }),
    ),
    Effect.flatMap((secret) =>
      requireSecretString(
        secret,
        "value",
        () =>
          new EnvExportError({ message: `Decrypted env var "${item.key}" is missing its value.` }),
      ),
    ),
  );

/** Decrypt a batch of sealed env vars into plaintext key/value/visibility entries. */
export const decryptEnvVars = (
  session: VaultSession,
  items: readonly SealedEnvVar[],
): Effect.Effect<readonly DecryptedEnvVar[], EnvExportError> =>
  Effect.forEach(
    items,
    (item) =>
      Effect.map(decryptEnvVarValue(session, item), (value) => ({
        key: item.key,
        value,
        visibility: item.visibility,
      })),
    { concurrency: 8 },
  );

/**
 * Export and decrypt every env var for a project + environment, in key order.
 * Skips unlocking the vault when the project has no variables; otherwise unlocks
 * once and decrypts every value locally (the server never sees plaintext).
 */
export const exportDecryptedEnvVars = (
  api: ApiClient,
  projectId: string,
  environment: EnvironmentName,
): Effect.Effect<
  readonly DecryptedEnvVar[],
  EnvExportError,
  Effect.Effect.Context<ReturnType<typeof openVaultSessionInteractive>>
> =>
  Effect.gen(function* () {
    const result = yield* api["env-vars"].export({ urlParams: { projectId, environment } }).pipe(
      Effect.mapError(
        (cause) =>
          new EnvExportError({
            message: `Failed to export environment variables for "${environment}": ${String(cause)}`,
          }),
      ),
    );
    if (result.items.length === 0) {
      return [];
    }
    const session = yield* openVaultSessionInteractive(api).pipe(
      Effect.mapError(
        (cause) =>
          new EnvExportError({
            message: `Could not unlock the credential vault to decrypt environment variables: ${cause.message}`,
          }),
      ),
    );
    return yield* decryptEnvVars(session, result.items);
  });

export interface PullEnvVarsOptions {
  readonly projectId: string;
  readonly environment: string;
}

/**
 * Pull + decrypt environment variables flattened into a key/value map for
 * injection into a build/subprocess.
 */
export const pullEnvVars = (
  api: ApiClient,
  { projectId, environment }: PullEnvVarsOptions,
): Effect.Effect<
  Record<string, string>,
  EnvExportError,
  Effect.Effect.Context<ReturnType<typeof openVaultSessionInteractive>>
> =>
  Effect.gen(function* () {
    const validated = coerceEnvironment(environment);
    if (!validated) {
      return yield* new EnvExportError({
        message: `Invalid environment "${environment}". Must be one of: development, preview, production.`,
      });
    }
    const items = yield* exportDecryptedEnvVars(api, projectId, validated);
    return Object.fromEntries(items.map((item) => [item.key, item.value]));
  });

export interface EnvEntryInput {
  readonly key: string;
  readonly value: string;
  readonly visibility: "plaintext" | "sensitive";
}

/**
 * Seal each entry for every target environment and bulk-upsert them. Unlocks the
 * vault once; the server stores only the sealed envelopes (never the plaintext).
 */
export const uploadEnvVars = (
  api: ApiClient,
  params: {
    readonly scope: "project" | "global";
    readonly projectId: string | undefined;
    readonly environments: readonly EnvironmentName[];
    readonly entries: readonly EnvEntryInput[];
  },
) =>
  Effect.gen(function* () {
    const session = yield* openVaultSessionInteractive(api);
    const pairs = params.environments.flatMap((environment) =>
      params.entries.map((entry) => ({ ...entry, environment })),
    );
    const sealed = yield* Effect.forEach(
      pairs,
      (pair) =>
        Effect.map(
          sealForUpload({
            session,
            credentialType: "envVarValue",
            metadata: { key: pair.key, environment: pair.environment },
            secret: { value: pair.value },
          }),
          (envelope) => ({
            key: pair.key,
            environment: pair.environment,
            visibility: pair.visibility,
            value: {
              id: envelope.id,
              ciphertext: envelope.ciphertext,
              wrappedDek: envelope.wrappedDek,
              vaultVersion: envelope.vaultVersion,
            },
          }),
        ),
      { concurrency: 8 },
    );
    return yield* api["env-vars"].bulkImport({
      payload: {
        scope: params.scope,
        ...(params.projectId === undefined ? {} : { projectId: params.projectId }),
        entries: sealed,
      },
    });
  });
