import { AuthContext, BadRequest, Conflict, EnvVar, Forbidden } from "@better-update/api";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { assertOrgOwnership, assertProjectOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { cloudflareEnv } from "../cloudflare/context";
import { decryptSecret, encryptSecret, resolveKeyring } from "../domain/credential-vault";
import { EnvVarRepo } from "../repositories/env-vars";

import type { EnvVarRow } from "../repositories/env-vars";

const RESERVED_KEYS = new Set(["PATH", "HOME", "USER", "SHELL"]);

const KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

const MAX_VARS_PER_PROJECT_ENV = 100;

const SENSITIVE_MASK = "••••••";

const maskValue = (row: EnvVarRow): string | null => {
  if (row.visibility === "plaintext") {
    return row.value;
  }
  if (row.visibility === "sensitive") {
    return SENSITIVE_MASK;
  }
  return null;
};

const rowToEnvVar = (row: EnvVarRow): EnvVar =>
  new EnvVar({
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    environment: row.environment,
    key: row.key,
    visibility: row.visibility,
    value: maskValue(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

const validateKey = (key: string) =>
  Effect.gen(function* () {
    if (!KEY_PATTERN.test(key)) {
      yield* new BadRequest({
        message: `Invalid key "${key}": must match ^[A-Z][A-Z0-9_]*$`,
      });
    }
    if (key.length > 256) {
      yield* new BadRequest({
        message: `Key "${key}" exceeds 256 character limit`,
      });
    }
    if (RESERVED_KEYS.has(key)) {
      yield* new BadRequest({
        message: `Key "${key}" is reserved and cannot be used`,
      });
    }
  });

const encryptValue = (vaultKeyring: string, orgId: string, value: string) =>
  Effect.gen(function* () {
    const keyring = yield* Effect.try({
      try: () => resolveKeyring(vaultKeyring),
      catch: () => new BadRequest({ message: "Vault keyring is not configured" }),
    });
    const result = yield* Effect.promise(async () => encryptSecret(keyring, orgId, value));
    return { encryptedValue: result.encrypted, keyVersion: result.keyVersion };
  });

const decryptValue = (vaultKeyring: string, orgId: string, keyVersion: number, encrypted: string) =>
  Effect.gen(function* () {
    const keyring = yield* Effect.try({
      try: () => resolveKeyring(vaultKeyring),
      catch: () => new BadRequest({ message: "Vault keyring is not configured" }),
    });
    return yield* Effect.promise(async () => decryptSecret(keyring, orgId, keyVersion, encrypted));
  });

const stripQuotes = (raw: string): string =>
  (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
    ? raw.slice(1, -1)
    : raw;

const parseEnvContent = (content: string): readonly { key: string; value: string }[] =>
  content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .flatMap((line) => {
      const eqIdx = line.indexOf("=");
      if (eqIdx === -1) {
        return [];
      }
      return [
        { key: line.slice(0, eqIdx).trim(), value: stripQuotes(line.slice(eqIdx + 1).trim()) },
      ];
    });

/** Build { value, encryptedValue, keyVersion } tuple based on visibility. */
const prepareStorageFields = (
  visibility: "plaintext" | "sensitive" | "secret",
  rawValue: string,
  orgId: string,
) =>
  visibility === "plaintext"
    ? Effect.succeed({
        value: rawValue as string | null,
        encryptedValue: null as string | null,
        keyVersion: null as number | null,
      })
    : Effect.gen(function* () {
        const env = yield* cloudflareEnv;
        const encrypted = yield* encryptValue(env.VAULT_KEYRING, orgId, rawValue);
        return {
          value: null as string | null,
          encryptedValue: encrypted.encryptedValue as string | null,
          keyVersion: encrypted.keyVersion as number | null,
        };
      });

const resolveUpdateFields = (
  existing: EnvVarRow,
  newVisibility: "plaintext" | "sensitive" | "secret",
  newValue: string | undefined,
  orgId: string,
): Effect.Effect<
  { value?: string | null; encryptedValue?: string | null; keyVersion?: number | null },
  BadRequest
> =>
  Effect.gen(function* () {
    if (newVisibility === "plaintext") {
      if (newValue !== undefined) {
        return { value: newValue, encryptedValue: null, keyVersion: null };
      }
      if (existing.visibility !== "plaintext" && existing.encrypted_value && existing.key_version) {
        const env = yield* cloudflareEnv;
        const decrypted = yield* decryptValue(
          env.VAULT_KEYRING,
          orgId,
          existing.key_version,
          existing.encrypted_value,
        );
        return { value: decrypted, encryptedValue: null, keyVersion: null };
      }
      return {};
    }

    // Sensitive or secret — need to encrypt
    const rawValue = newValue ?? (existing.visibility === "plaintext" ? existing.value : null);

    if (rawValue) {
      const env = yield* cloudflareEnv;
      const encrypted = yield* encryptValue(env.VAULT_KEYRING, orgId, rawValue);
      return {
        value: null,
        encryptedValue: encrypted.encryptedValue,
        keyVersion: encrypted.keyVersion,
      };
    }

    return {};
  });

export const EnvVarsGroupLive = HttpApiBuilder.group(ManagementApi, "env-vars", (handlers) =>
  handlers
    .handle("create", ({ payload }) =>
      Effect.gen(function* () {
        yield* assertPermission("envVar", "create");
        const ctx = yield* AuthContext;
        yield* assertProjectOwnership(payload.projectId);
        yield* validateKey(payload.key);

        const repo = yield* EnvVarRepo;

        const count = yield* repo.countByProjectEnv({
          projectId: payload.projectId,
          environment: payload.environment,
        });
        if (count >= MAX_VARS_PER_PROJECT_ENV) {
          return yield* new BadRequest({
            message: `Maximum of ${MAX_VARS_PER_PROJECT_ENV} variables per project+environment reached`,
          });
        }

        const fields = yield* prepareStorageFields(
          payload.visibility,
          payload.value,
          ctx.organizationId,
        );

        const row = yield* repo
          .insert({
            id: crypto.randomUUID(),
            organizationId: ctx.organizationId,
            projectId: payload.projectId,
            environment: payload.environment,
            key: payload.key,
            visibility: payload.visibility,
            ...fields,
          })
          .pipe(
            Effect.catchAllDefect((defect) => {
              const msg = defect instanceof Error ? defect.message : String(defect);
              if (msg.includes("UNIQUE constraint failed")) {
                return Effect.fail(
                  new Conflict({
                    message: `Variable "${payload.key}" already exists in this environment`,
                  }),
                );
              }
              return Effect.die(defect);
            }),
          );

        return rowToEnvVar(row);
      }),
    )
    .handle("list", ({ urlParams }) =>
      Effect.gen(function* () {
        yield* assertPermission("envVar", "read");
        const ctx = yield* AuthContext;
        yield* assertProjectOwnership(urlParams.projectId);

        const repo = yield* EnvVarRepo;
        const page = urlParams.page ?? 1;
        const limit = urlParams.limit ?? 50;
        const offset = (page - 1) * limit;

        const { items, total } = yield* repo.list({
          organizationId: ctx.organizationId,
          projectId: urlParams.projectId,
          ...(urlParams.environment ? { environment: urlParams.environment } : {}),
          limit,
          offset,
        });

        return { items: items.map(rowToEnvVar), total, page, limit };
      }),
    )
    .handle("get", ({ path }) =>
      Effect.gen(function* () {
        yield* assertPermission("envVar", "read");

        const repo = yield* EnvVarRepo;
        const row = yield* repo.findById({ id: path.id });
        yield* assertOrgOwnership(row.organization_id);

        return rowToEnvVar(row);
      }),
    )
    .handle("update", ({ path, payload }) =>
      Effect.gen(function* () {
        yield* assertPermission("envVar", "update");
        const ctx = yield* AuthContext;

        const repo = yield* EnvVarRepo;
        const existing = yield* repo.findById({ id: path.id });
        yield* assertOrgOwnership(existing.organization_id);

        const newVisibility = payload.visibility ?? existing.visibility;
        const hasNewValue = payload.value !== undefined;
        const needsUpdate =
          hasNewValue || (payload.visibility && payload.visibility !== existing.visibility);

        const updateFields = needsUpdate
          ? yield* resolveUpdateFields(
              existing,
              newVisibility,
              hasNewValue ? payload.value : undefined,
              ctx.organizationId,
            )
          : {};

        const row = yield* repo.update({
          id: path.id,
          ...updateFields,
          ...(payload.visibility ? { visibility: payload.visibility } : {}),
        });

        return rowToEnvVar(row);
      }),
    )
    .handle("delete", ({ path }) =>
      Effect.gen(function* () {
        yield* assertPermission("envVar", "delete");

        const repo = yield* EnvVarRepo;
        const row = yield* repo.findById({ id: path.id });
        yield* assertOrgOwnership(row.organization_id);

        yield* repo.deleteById({ id: path.id });

        return { id: path.id };
      }),
    )
    .handle("bulkImport", ({ payload }) =>
      Effect.gen(function* () {
        yield* assertPermission("envVar", "create");
        const ctx = yield* AuthContext;
        yield* assertProjectOwnership(payload.projectId);

        const entries = parseEnvContent(payload.content);
        if (entries.length === 0) {
          return yield* new BadRequest({
            message: "No valid entries found in the provided content",
          });
        }

        // Validate all keys
        yield* Effect.forEach(entries, (entry) => validateKey(entry.key), { discard: true });

        const repo = yield* EnvVarRepo;
        const currentCount = yield* repo.countByProjectEnv({
          projectId: payload.projectId,
          environment: payload.environment,
        });

        // Deduplicate: last entry wins
        const deduped = new Map(entries.map((entry) => [entry.key, entry.value] as const));
        const skipped = entries.length - deduped.size;

        if (currentCount + deduped.size > MAX_VARS_PER_PROJECT_ENV) {
          return yield* new BadRequest({
            message: `Import would exceed the ${MAX_VARS_PER_PROJECT_ENV} variable limit`,
          });
        }

        const results = yield* Effect.forEach(
          [...deduped.entries()],
          ([key, rawValue]) =>
            Effect.gen(function* () {
              const fields = yield* prepareStorageFields(
                payload.visibility,
                rawValue,
                ctx.organizationId,
              );
              return yield* repo.upsert({
                id: crypto.randomUUID(),
                organizationId: ctx.organizationId,
                projectId: payload.projectId,
                environment: payload.environment,
                key,
                visibility: payload.visibility,
                ...fields,
              });
            }),
          { concurrency: 1 },
        );

        const created = results.filter((result) => result === "created").length;
        const updated = results.filter((result) => result === "updated").length;

        return { created, updated, skipped };
      }),
    )
    .handle("export", ({ urlParams }) =>
      Effect.gen(function* () {
        const ctx = yield* AuthContext;
        if (ctx.source !== "api-key") {
          return yield* new Forbidden({
            message: "This endpoint requires API key authentication",
          });
        }

        yield* assertPermission("envVar", "read");
        yield* assertProjectOwnership(urlParams.projectId);

        const repo = yield* EnvVarRepo;
        const environments = urlParams.environment === "*" ? ["*"] : ["*", urlParams.environment];

        const rows = yield* repo.findAllByProjectEnvs({
          projectId: urlParams.projectId,
          environments,
        });

        // Merge: environment-specific overrides shared
        const merged = new Map<string, EnvVarRow>();
        rows.forEach((row) => {
          const prev = merged.get(row.key);
          if (!prev || (prev.environment === "*" && row.environment !== "*")) {
            merged.set(row.key, row);
          }
        });

        const env = yield* cloudflareEnv;
        const items = yield* Effect.forEach(
          [...merged.values()],
          (row) =>
            row.visibility === "plaintext" || !row.encrypted_value || !row.key_version
              ? Effect.succeed({ key: row.key, value: row.value ?? "", visibility: row.visibility })
              : Effect.map(
                  decryptValue(
                    env.VAULT_KEYRING,
                    ctx.organizationId,
                    row.key_version,
                    row.encrypted_value,
                  ),
                  (decrypted) => ({ key: row.key, value: decrypted, visibility: row.visibility }),
                ),
          { concurrency: 5 },
        );

        const sorted = [...items].toSorted((left, right) => left.key.localeCompare(right.key));
        return { items: sorted, environment: urlParams.environment };
      }),
    ),
);
