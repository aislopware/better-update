import { Effect } from "effect";

import { assertVaultVersionCurrent } from "../application/assert-vault-version";
import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership, assertProjectOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { assertPermissionOn, buildEnvVarScopeId, ENV_VAR_SCOPE_KIND } from "../auth/scope";
import { BadRequest, Forbidden } from "../errors";
import { toDbNull } from "../lib/nullable";
import { EnvVarRepo } from "../repositories/env-vars";
import { EnvironmentGrantRepo } from "../repositories/environment-grant-repo";

import type { EnvVarModel } from "../env-var-models";
import type { Action, EnvVarEnvironment, EnvVarVisibility } from "../models";
import type { EnvVarListScope } from "../repositories/env-vars";

export const RESERVED_KEYS: ReadonlySet<string> = new Set(["PATH", "HOME", "USER", "SHELL"]);

export const KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/u;

export const MAX_VARS_PER_PROJECT = 5000;
export const MAX_VARS_PER_ORG_GLOBAL = 5000;

export const isValidEnvironment = (value: string): value is EnvVarEnvironment =>
  value === "development" || value === "preview" || value === "production";

/**
 * Per (project × environment) scoped permission gate for env vars. Delegates to
 * the generic `assertPermissionOn` with scopeKind = env_var_environment and a
 * scope id built from (projectId-or-null, environment). A failed scoped check is a
 * Forbidden (403). Deny-wins / baseline / allow resolution is entirely inside
 * `assertPermissionOn` — unchanged.
 */
export const assertEnvVarScopedPermission = (
  action: Action,
  projectId: string | null,
  environment: EnvVarEnvironment,
) =>
  assertPermissionOn("envVar", action, {
    scopeKind: ENV_VAR_SCOPE_KIND,
    scopeId: buildEnvVarScopeId(projectId, environment),
  });

const ENV_VAR_READ_TOKEN = "envVar:read" as const;

/**
 * Resolve the actor's per (project × environment) env-var READ access ONCE into an
 * in-memory predicate. Deny-wins, mirroring `assertPermissionOn`:
 *   - matching deny on the scope id           -> false
 *   - else role baseline allows envVar:read   -> true
 *   - else a matching allow grant on the scope -> true
 *   - else                                     -> false
 * API-key actors (no member id) skip the grant query: predicate = baseline only.
 *
 * The predicate keys on the SAME scope id the create/get/etc. asserts use, so
 * `scope=all` list rows (project rows by projectId, global rows by the sentinel)
 * filter uniformly.
 */
export const resolveEnvReadPredicate = () =>
  Effect.gen(function* () {
    const ctx = yield* CurrentActor;
    const baseline = ctx.effectivePermissions.envVar?.includes("read") ?? false;

    // API-key principal: no grants apply, baseline only.
    if (!ctx.memberId) {
      return () => baseline;
    }

    const repo = yield* EnvironmentGrantRepo;
    const grants = yield* repo.findForMemberByScopeKind({
      memberId: ctx.memberId,
      scopeKind: ENV_VAR_SCOPE_KIND,
    });

    // Index grants by scope id -> { denied, allowed } for envVar:read.
    const byScope = grants.reduce((acc, grant) => {
      const slot = acc.get(grant.scopeId) ?? { denied: false, allowed: false };
      if (grant.actions.includes(ENV_VAR_READ_TOKEN)) {
        if (grant.effect === "deny") {
          slot.denied = true;
        } else {
          slot.allowed = true;
        }
      }
      return acc.set(grant.scopeId, slot);
    }, new Map<string, { denied: boolean; allowed: boolean }>());

    return (projectId: string | null, environment: EnvVarEnvironment) => {
      const slot = byScope.get(buildEnvVarScopeId(projectId, environment));
      if (slot?.denied) {
        return false;
      }
      if (baseline) {
        return true;
      }
      return slot?.allowed ?? false;
    };
  });

export const validateKey = (key: string) =>
  Effect.gen(function* () {
    if (!KEY_PATTERN.test(key)) {
      return yield* new BadRequest({
        message: `Invalid key "${key}": must match ^[A-Z][A-Z0-9_]*$`,
      });
    }
    if (key.length > 256) {
      return yield* new BadRequest({
        message: `Key "${key}" exceeds 256 character limit`,
      });
    }
    if (RESERVED_KEYS.has(key)) {
      return yield* new BadRequest({
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

// A project var overrides a global var only for the same key AND environment.
const keyEnv = (model: EnvVarModel) => `${model.environment} ${model.key}`;

export interface OverrideResolved {
  readonly model: EnvVarModel;
  readonly overridesGlobal: boolean;
}

/**
 * Drop global vars shadowed by a project var (same key+environment) and flag the
 * project var as overriding. Operates on metadata models — values are encrypted.
 */
export const applyOverrideResolution = (
  models: readonly EnvVarModel[],
): readonly OverrideResolved[] => {
  const projectKeyEnvs = new Set(models.filter((model) => model.scope === "project").map(keyEnv));
  const globalKeyEnvs = new Set(models.filter((model) => model.scope === "global").map(keyEnv));
  return models
    .filter((model) => !(model.scope === "global" && projectKeyEnvs.has(keyEnv(model))))
    .map((model) => ({
      model,
      overridesGlobal: model.scope === "project" && globalKeyEnvs.has(keyEnv(model)),
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
    // Export returns sealed value envelopes (the CLI decrypts them), so it stays
    // off the browser dashboard. Gate on transport (Authorization-bearer = CLI
    // session or CI API key) rather than source, since the CLI is a real session.
    if (ctx.transport !== "bearer") {
      return yield* new Forbidden({
        message:
          "This endpoint requires CLI or API-key (bearer) authentication, not a browser session",
      });
    }

    yield* assertPermission("envVar", "read");
    yield* assertProjectOwnership(urlParams.projectId);
    yield* assertEnvVarScopedPermission("read", urlParams.projectId, urlParams.environment);

    const repo = yield* EnvVarRepo;
    const rows = yield* repo.listForExport({
      organizationId: ctx.organizationId,
      projectId: urlParams.projectId,
      environment: urlParams.environment,
    });

    // Project value wins over a global one with the same key.
    const projectKeys = new Set(
      rows.filter((row) => row.scope === "project").map((row) => row.key),
    );
    const items = rows
      .filter((row) => !(row.scope === "global" && projectKeys.has(row.key)))
      .map((row) => ({
        key: row.key,
        environment: row.environment,
        visibility: row.visibility,
        id: row.revisionId,
        ciphertext: row.valueCiphertext,
        wrappedDek: row.wrappedDek,
        vaultVersion: row.vaultVersion,
      }));

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

/**
 * Reject a single-var create that would breach the per-scope cap. Project scope
 * counts rows for the project (cap = {@link MAX_VARS_PER_PROJECT}); global scope
 * counts the org's global rows (cap = {@link MAX_VARS_PER_ORG_GLOBAL}).
 */
export const assertEnvVarCountWithinCap = (
  scope: "project" | "global",
  projectId: string | undefined,
  organizationId: string,
) =>
  Effect.gen(function* () {
    const repo = yield* EnvVarRepo;
    if (scope === "project" && projectId) {
      const count = yield* repo.countByProject({ projectId });
      if (count >= MAX_VARS_PER_PROJECT) {
        return yield* new BadRequest({
          message: `Maximum of ${MAX_VARS_PER_PROJECT} variables per project reached`,
        });
      }
      return undefined;
    }
    const count = yield* repo.countByOrgGlobal({ organizationId });
    if (count >= MAX_VARS_PER_ORG_GLOBAL) {
      return yield* new BadRequest({
        message: `Maximum of ${MAX_VARS_PER_ORG_GLOBAL} global variables per organization reached`,
      });
    }
    return undefined;
  });

export interface BulkImportEntryInput {
  readonly key: string;
  readonly environment: EnvVarEnvironment;
  readonly visibility: EnvVarVisibility;
  // The wire envelope (`ciphertext`), reshaped to the repo's revision input below.
  readonly value: {
    readonly id: string;
    readonly ciphertext: string;
    readonly wrappedDek: string;
    readonly vaultVersion: number;
  };
}

export interface BulkImportPayload {
  readonly scope: "project" | "global";
  readonly projectId?: string | undefined;
  readonly entries: readonly BulkImportEntryInput[];
}

const dedupeKey = (environment: EnvVarEnvironment, key: string) => `${environment} ${key}`;

// Every entry must be sealed at the same, current vault version. An empty entry
// set has no version to check (a no-op).
const assertBulkEntriesShareCurrentVaultVersion = (
  organizationId: string,
  entries: readonly BulkImportEntryInput[],
) =>
  Effect.gen(function* () {
    const versions = new Set(entries.map((entry) => entry.value.vaultVersion));
    if (versions.size > 1) {
      return yield* new BadRequest({
        message: "All entries must be sealed at the same vault version",
      });
    }
    const [version] = [...versions];
    if (version !== undefined) {
      yield* assertVaultVersionCurrent({ organizationId, vaultVersion: version });
    }
    return undefined;
  });

export const handleBulkImport = (payload: BulkImportPayload) =>
  Effect.gen(function* () {
    yield* assertPermission("envVar", "create");
    const ctx = yield* CurrentActor;
    yield* assertScopeOwnership(payload.scope, payload.projectId);

    yield* Effect.forEach(payload.entries, (entry) => validateKey(entry.key), { discard: true });

    const projectId = payload.scope === "project" ? toDbNull(payload.projectId) : null;
    const distinctEnvironments = [...new Set(payload.entries.map((entry) => entry.environment))];
    yield* Effect.forEach(
      distinctEnvironments,
      (environment) => assertEnvVarScopedPermission("create", projectId, environment),
      { discard: true },
    );

    yield* assertBulkEntriesShareCurrentVaultVersion(ctx.organizationId, payload.entries);

    const repo = yield* EnvVarRepo;

    // Dedup by (key, environment); a later entry wins.
    const deduped = new Map(
      payload.entries.map((entry) => [dedupeKey(entry.environment, entry.key), entry] as const),
    );
    const skipped = payload.entries.length - deduped.size;

    // Cap = existing rows for the scope + the brand-new (key,environment) rows.
    const existing = yield* repo.list({
      organizationId: ctx.organizationId,
      ...(payload.projectId ? { projectId: payload.projectId } : {}),
      scope: payload.scope,
      limit: 1000,
      offset: 0,
    });
    const existingPairs = new Set(
      existing.items.map((model) => dedupeKey(model.environment, model.key)),
    );
    const newCount = [...deduped.keys()].filter((pair) => !existingPairs.has(pair)).length;
    const limitMax = payload.scope === "project" ? MAX_VARS_PER_PROJECT : MAX_VARS_PER_ORG_GLOBAL;
    if (existing.items.length + newCount > limitMax) {
      return yield* new BadRequest({
        message: `Import would exceed the ${limitMax} variable limit`,
      });
    }

    const results = yield* Effect.forEach(
      [...deduped.values()],
      (entry) =>
        repo.upsert({
          organizationId: ctx.organizationId,
          projectId,
          scope: payload.scope,
          environment: entry.environment,
          key: entry.key,
          visibility: entry.visibility,
          createdByUserId: ctx.userId,
          revision: {
            id: entry.value.id,
            valueCiphertext: entry.value.ciphertext,
            wrappedDek: entry.value.wrappedDek,
            vaultVersion: entry.value.vaultVersion,
          },
        }),
      { concurrency: 5 },
    );

    const created = results.filter((result) => result === "created").length;
    const updated = results.filter((result) => result === "updated").length;
    return { created, updated, skipped };
  });
