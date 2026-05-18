import { parseDotenvEntries } from "@better-update/dotenv";
import { Effect } from "effect";

import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership, assertProjectOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { BadRequest, Forbidden } from "../errors";
import { toDbNull } from "../lib/nullable";
import { requireValue } from "../lib/require-value";
import { EnvVarRepo } from "../repositories/env-vars";

import type { EnvVarEnvironment, EnvVarVisibility } from "../models";
import type { EnvVarListScope, EnvVarRow } from "../repositories/env-vars";

export const RESERVED_KEYS: ReadonlySet<string> = new Set(["PATH", "HOME", "USER", "SHELL"]);

export const KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/u;

export const MAX_VARS_PER_PROJECT = 100;
export const MAX_VARS_PER_ORG_GLOBAL = 100;

export const isValidEnvironment = (value: string): value is EnvVarEnvironment =>
  value === "development" || value === "preview" || value === "production";

export const toEnvVarModel = (row: EnvVarRow, overridesGlobal?: boolean) => ({
  id: row.id,
  organizationId: row.organization_id,
  projectId: row.project_id,
  scope: row.scope,
  key: row.key,
  visibility: row.visibility,
  value: row.value,
  environments: row.environments,
  ...(overridesGlobal ? { overridesGlobal: true } : {}),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const validateKey = (key: string) =>
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

export const validateEnvironments = (
  environments: readonly string[],
): Effect.Effect<readonly EnvVarEnvironment[], BadRequest> =>
  Effect.gen(function* () {
    if (environments.length === 0) {
      return yield* new BadRequest({ message: "At least one environment is required" });
    }
    const seen = new Set<EnvVarEnvironment>();
    yield* Effect.forEach(
      environments,
      (env) =>
        Effect.gen(function* () {
          if (!isValidEnvironment(env)) {
            return yield* new BadRequest({
              message: `Invalid environment "${env}". Must be one of: development, preview, production`,
            });
          }
          if (seen.has(env)) {
            return yield* new BadRequest({ message: `Duplicate environment "${env}"` });
          }
          seen.add(env);
          return undefined;
        }),
      { discard: true },
    );
    return [...seen];
  });

export const parseEnvironmentsCsv = (
  csv: string | undefined,
): Effect.Effect<readonly EnvVarEnvironment[] | undefined, BadRequest> =>
  Effect.gen(function* () {
    if (!csv || csv.trim().length === 0) {
      return undefined;
    }
    const tokens = csv
      .split(",")
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    return yield* validateEnvironments(tokens);
  });

export interface OverrideResolved {
  readonly row: EnvVarRow;
  readonly overridesGlobal: boolean;
}

export const applyOverrideResolution = (
  rows: readonly EnvVarRow[],
): readonly OverrideResolved[] => {
  const projectKeys = new Set(rows.filter((row) => row.scope === "project").map((row) => row.key));
  const globalKeys = new Set(rows.filter((row) => row.scope === "global").map((row) => row.key));
  return rows
    .filter((row) => !(row.scope === "global" && projectKeys.has(row.key)))
    .map((row) => ({
      row,
      overridesGlobal: row.scope === "project" && globalKeys.has(row.key),
    }));
};

export const resolveListScope = (params: {
  readonly scope?: EnvVarListScope | undefined;
  readonly projectId?: string | undefined;
}): EnvVarListScope => params.scope ?? (params.projectId ? "all" : "global");

export const handleExport = (urlParams: {
  readonly projectId: string;
  readonly environment: EnvVarEnvironment;
}) =>
  Effect.gen(function* () {
    const ctx = yield* CurrentActor;
    if (ctx.source !== "api-key") {
      return yield* new Forbidden({
        message: "This endpoint requires API key authentication",
      });
    }

    yield* assertPermission("envVar", "read");
    yield* assertProjectOwnership(urlParams.projectId);

    const repo = yield* EnvVarRepo;

    const { items: rows } = yield* repo.list({
      organizationId: ctx.organizationId,
      projectId: urlParams.projectId,
      scope: "all",
      environments: [urlParams.environment],
      limit: 1000,
      offset: 0,
    });

    const resolved = applyOverrideResolution(rows).map((entry) => entry.row);

    const items = yield* Effect.forEach(
      resolved,
      (row) =>
        Effect.gen(function* () {
          const value = yield* requireValue(row.value, `env-var:${row.key}`);
          return { key: row.key, value, visibility: row.visibility };
        }),
      { concurrency: 5 },
    );

    const sorted = [...items].toSorted((left, right) => left.key.localeCompare(right.key));
    return { items: sorted, environment: urlParams.environment };
  });

export const assertScopeOwnership = (scope: "project" | "global", projectId: string | undefined) =>
  Effect.gen(function* () {
    if (scope === "project") {
      if (!projectId) {
        return yield* new BadRequest({
          message: "projectId is required when scope is 'project'",
        });
      }
      yield* assertProjectOwnership(projectId);
      return undefined;
    }
    if (projectId) {
      return yield* new BadRequest({
        message: "projectId must be omitted when scope is 'global'",
      });
    }
    const ctx = yield* CurrentActor;
    yield* assertOrgOwnership(ctx.organizationId);
    return undefined;
  });

export interface BulkImportPayload {
  readonly scope: "project" | "global";
  readonly projectId?: string | undefined;
  readonly environments: readonly string[];
  readonly content?: string | undefined;
  readonly entries?:
    | readonly {
        readonly key: string;
        readonly value: string;
        readonly visibility?: EnvVarVisibility | undefined;
      }[]
    | undefined;
  readonly visibility?: EnvVarVisibility | undefined;
}

interface ResolvedEntry {
  readonly key: string;
  readonly value: string;
  readonly visibility: EnvVarVisibility;
}

const resolveBulkImportEntries = (payload: BulkImportPayload) =>
  Effect.gen(function* () {
    const { content, entries } = payload;
    const hasContent = content !== undefined && content.length > 0;
    const hasEntries = entries !== undefined && entries.length > 0;
    if (hasContent && hasEntries) {
      return yield* new BadRequest({
        message: "Provide either `content` or `entries`, not both",
      });
    }
    if (hasEntries) {
      return yield* Effect.forEach(
        entries,
        (entry) =>
          Effect.gen(function* () {
            const visibility = entry.visibility ?? payload.visibility;
            if (!visibility) {
              return yield* new BadRequest({
                message: `Visibility is required for entry "${entry.key}"`,
              });
            }
            return { key: entry.key, value: entry.value, visibility } satisfies ResolvedEntry;
          }),
        { concurrency: 1 },
      );
    }
    if (hasContent) {
      const { visibility } = payload;
      if (!visibility) {
        return yield* new BadRequest({
          message: "Top-level `visibility` is required when sending `content`",
        });
      }
      return parseDotenvEntries(content).map(
        (entry) => ({ key: entry.key, value: entry.value, visibility }) satisfies ResolvedEntry,
      );
    }
    return yield* new BadRequest({
      message: "One of `content` or `entries` is required",
    });
  });

export const handleBulkImport = (payload: BulkImportPayload) =>
  Effect.gen(function* () {
    yield* assertPermission("envVar", "create");
    const ctx = yield* CurrentActor;
    yield* assertScopeOwnership(payload.scope, payload.projectId);

    const environments = yield* validateEnvironments(payload.environments);
    const entries = yield* resolveBulkImportEntries(payload);
    if (entries.length === 0) {
      return yield* new BadRequest({
        message: "No valid entries found",
      });
    }
    yield* Effect.forEach(entries, (entry) => validateKey(entry.key), { discard: true });

    const repo = yield* EnvVarRepo;
    const deduped = new Map(
      entries.map(
        (entry) => [entry.key, { value: entry.value, visibility: entry.visibility }] as const,
      ),
    );
    const skipped = entries.length - deduped.size;

    const limitMax = payload.scope === "project" ? MAX_VARS_PER_PROJECT : MAX_VARS_PER_ORG_GLOBAL;
    const existingCount =
      payload.scope === "project" && payload.projectId
        ? yield* repo.countByProject({ projectId: payload.projectId })
        : yield* repo.countByOrgGlobal({ organizationId: ctx.organizationId });

    if (existingCount + deduped.size > limitMax) {
      return yield* new BadRequest({
        message: `Import would exceed the ${limitMax} variable limit`,
      });
    }

    const results = yield* Effect.forEach(
      [...deduped.entries()],
      ([key, payloadEntry]) =>
        upsertOne(payload, environments, key, payloadEntry, ctx.organizationId),
      { concurrency: 5 },
    );

    const created = results.filter((result) => result === "created").length;
    const updated = results.filter((result) => result === "updated").length;
    return { created, updated, skipped, environments };
  });

const upsertOne = (
  payload: BulkImportPayload,
  environments: readonly EnvVarEnvironment[],
  key: string,
  entry: { readonly value: string; readonly visibility: EnvVarVisibility },
  orgId: string,
) =>
  Effect.gen(function* () {
    const repo = yield* EnvVarRepo;
    return yield* repo.upsert({
      id: crypto.randomUUID(),
      organizationId: orgId,
      projectId: payload.scope === "project" ? toDbNull(payload.projectId) : null,
      scope: payload.scope,
      key,
      visibility: entry.visibility,
      value: entry.value,
      environments,
    });
  });
