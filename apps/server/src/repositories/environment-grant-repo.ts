import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";

import type { EnvironmentGrantModel, GrantEffect, ScopeKind } from "../authz-models";

// -- Port -------------------------------------------------------------------

export interface EnvironmentGrantRepository {
  /**
   * All grants for ONE member on ONE scope object. Used by `assertPermissionOn`.
   * Returns both allow + deny rows (caller applies deny-wins).
   */
  readonly findForMemberOnScope: (params: {
    readonly memberId: string;
    readonly scopeKind: ScopeKind;
    readonly scopeId: string;
  }) => Effect.Effect<readonly EnvironmentGrantModel[]>;

  /** All grants on a scope (for the grants list UI/handler). */
  readonly findByScope: (params: {
    readonly scopeKind: ScopeKind;
    readonly scopeId: string;
  }) => Effect.Effect<readonly EnvironmentGrantModel[]>;

  /**
   * All grants for ONE member across ALL scope ids of ONE scope_kind. Used by
   * `resolveEnvReadPredicate` to build an in-memory deny-wins predicate over many
   * (project × environment) scopes in a single query — the list handler cannot
   * call the single-shot scoped assert per row.
   */
  readonly findForMemberByScopeKind: (params: {
    readonly memberId: string;
    readonly scopeKind: ScopeKind;
  }) => Effect.Effect<readonly EnvironmentGrantModel[]>;

  /**
   * Upsert ONE (member, scope, effect) row by replacing its `actions` JSON. The
   * grant handler writes effect="allow" with the full action set; deny rows are
   * written the same way with effect="deny". `organizationId` is required for the
   * FK + tenant scoping.
   */
  readonly upsert: (params: {
    readonly organizationId: string;
    readonly memberId: string;
    readonly scopeKind: ScopeKind;
    readonly scopeId: string;
    readonly effect: GrantEffect;
    readonly actions: readonly string[];
  }) => Effect.Effect<EnvironmentGrantModel>;

  /** Remove all grants (both effects) for one member on one scope. */
  readonly deleteForMemberOnScope: (params: {
    readonly memberId: string;
    readonly scopeKind: ScopeKind;
    readonly scopeId: string;
  }) => Effect.Effect<void>;

  /** Sweep all grants on a scope (called when the scope object is deleted). */
  readonly deleteByScope: (params: {
    readonly scopeKind: ScopeKind;
    readonly scopeId: string;
  }) => Effect.Effect<void>;
}

export class EnvironmentGrantRepo extends Context.Tag("api/EnvironmentGrantRepo")<
  EnvironmentGrantRepo,
  EnvironmentGrantRepository
>() {}

// -- D1 Adapter -------------------------------------------------------------

// `scope_kind` / `effect` are typed as their literal unions: the table's CHECK
// constraints (migration 0055) guarantee the column never holds another value, so
// the I/O boundary can trust them without a per-row narrowing assertion.
interface EnvironmentGrantRow {
  id: string;
  organization_id: string;
  member_id: string;
  scope_kind: ScopeKind;
  scope_id: string;
  effect: GrantEffect;
  actions: string;
  created_at: string;
}

const parseActions = (raw: string): readonly string[] =>
  // The column is a JSON array of "resource:action" strings we wrote ourselves.
  // eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- JSON column round-trips our own string[] payload
  JSON.parse(raw) as readonly string[];

const toModel = (row: EnvironmentGrantRow) =>
  ({
    id: row.id,
    organizationId: row.organization_id,
    memberId: row.member_id,
    scopeKind: row.scope_kind,
    scopeId: row.scope_id,
    effect: row.effect,
    actions: parseActions(row.actions),
    createdAt: row.created_at,
  }) satisfies EnvironmentGrantModel;

const GRANT_COLUMNS = `"id", "organization_id", "member_id", "scope_kind", "scope_id", "effect", "actions", "created_at"`;

export const EnvironmentGrantRepoLive = Layer.succeed(EnvironmentGrantRepo, {
  findForMemberOnScope: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${GRANT_COLUMNS} FROM "environment_grant" WHERE "member_id" = ? AND "scope_kind" = ? AND "scope_id" = ?`,
        )
          .bind(params.memberId, params.scopeKind, params.scopeId)
          .all<EnvironmentGrantRow>(),
      );
      return rows.results.map(toModel);
    }),

  findByScope: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${GRANT_COLUMNS} FROM "environment_grant" WHERE "scope_kind" = ? AND "scope_id" = ? ORDER BY "created_at" ASC`,
        )
          .bind(params.scopeKind, params.scopeId)
          .all<EnvironmentGrantRow>(),
      );
      return rows.results.map(toModel);
    }),

  findForMemberByScopeKind: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${GRANT_COLUMNS} FROM "environment_grant" WHERE "member_id" = ? AND "scope_kind" = ?`,
        )
          .bind(params.memberId, params.scopeKind)
          .all<EnvironmentGrantRow>(),
      );
      return rows.results.map(toModel);
    }),

  upsert: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const actionsJson = JSON.stringify([...params.actions]);

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `INSERT INTO "environment_grant" (${GRANT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT ("member_id", "scope_kind", "scope_id", "effect") DO UPDATE SET "actions" = excluded."actions" RETURNING ${GRANT_COLUMNS}`,
        )
          .bind(
            id,
            params.organizationId,
            params.memberId,
            params.scopeKind,
            params.scopeId,
            params.effect,
            actionsJson,
            now,
          )
          .first<EnvironmentGrantRow>(),
      );

      if (row === null) {
        // RETURNING always yields the upserted row; fall back to the input shape
        // defensively so the contract stays total.
        return {
          id,
          organizationId: params.organizationId,
          memberId: params.memberId,
          scopeKind: params.scopeKind,
          scopeId: params.scopeId,
          effect: params.effect,
          actions: [...params.actions],
          createdAt: now,
        } satisfies EnvironmentGrantModel;
      }

      return toModel(row);
    }),

  deleteForMemberOnScope: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.DB.prepare(
          `DELETE FROM "environment_grant" WHERE "member_id" = ? AND "scope_kind" = ? AND "scope_id" = ?`,
        )
          .bind(params.memberId, params.scopeKind, params.scopeId)
          .run(),
      );
    }),

  deleteByScope: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.DB.prepare(`DELETE FROM "environment_grant" WHERE "scope_kind" = ? AND "scope_id" = ?`)
          .bind(params.scopeKind, params.scopeId)
          .run(),
      );
    }),
});
