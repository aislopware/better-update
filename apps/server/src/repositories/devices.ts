import { compact } from "@better-update/type-guards";
import { Context, Effect, Layer } from "effect";
import { sql } from "kysely";

import type { Expression, ExpressionBuilder, NotNull, Selectable, SqlBool } from "kysely";

import { kyselyDb } from "../cloudflare/db";
import { NotFound } from "../errors";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { DB } from "../db/schema";
import type { Conflict } from "../errors";
import type { DeviceClass, DeviceModel } from "../models";

export type DeviceSortKey = "name" | "createdAt" | "deviceClass";

export type DeviceSortOrder = "asc" | "desc";

// ── Port ──────────────────────────────────────────────────────────

export interface DeviceRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly appleTeamId: string | null;
    readonly identifier: string;
    readonly name: string;
    readonly model: string | null;
    readonly deviceClass: DeviceClass;
    readonly enabled: boolean;
    readonly appleDevicePortalId: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  }) => Effect.Effect<void, Conflict>;

  readonly findByOrg: (params: {
    readonly organizationId: string;
    readonly sort: DeviceSortKey;
    readonly order: DeviceSortOrder;
    readonly limit: number;
    readonly offset: number;
    readonly deviceClass?: readonly DeviceClass[] | undefined;
    readonly appleTeamId?: readonly string[] | undefined;
    /**
     * Binding scope (GITLAB-RBAC-SPEC §1a): restrict to devices of these
     * Apple team rows (team-less devices excluded). `undefined` = no scope
     * (admin tier). An empty list matches nothing.
     */
    readonly appleTeamIdIn?: readonly string[] | undefined;
    readonly query?: string | undefined;
  }) => Effect.Effect<{ readonly items: readonly DeviceModel[]; readonly total: number }>;

  readonly findAllByOrg: (params: {
    readonly organizationId: string;
    readonly appleTeamId?: string | undefined;
  }) => Effect.Effect<readonly DeviceModel[]>;

  readonly findById: (params: { readonly id: string }) => Effect.Effect<DeviceModel, NotFound>;

  readonly findByIdentifier: (params: {
    readonly organizationId: string;
    readonly appleTeamId: string | null;
    readonly identifier: string;
  }) => Effect.Effect<DeviceModel, NotFound>;

  readonly update: (params: {
    readonly id: string;
    readonly name?: string | undefined;
    readonly enabled?: boolean | undefined;
    readonly appleTeamId?: string | null | undefined;
    readonly updatedAt: string;
  }) => Effect.Effect<void, Conflict>;

  readonly setApplePortalId: (params: {
    readonly id: string;
    readonly appleDevicePortalId: string;
    readonly updatedAt: string;
  }) => Effect.Effect<void>;

  readonly delete: (params: { readonly id: string }) => Effect.Effect<void>;
}

export class DeviceRepo extends Context.Tag("api/DeviceRepo")<DeviceRepo, DeviceRepository>() {}

// ── D1 Adapter ────────────────────────────────────────────────────

// The full `devices` projection. `devices.id` is a TEXT primary key the codegen
// types as nullable, but every query here selects it and the row always carries
// it — the `$narrowType<{ id: NotNull }>()` on each select reflects that, so the
// mapper input intersects a non-null `id`.
type DeviceRow = Selectable<DB["devices"]> & { id: string };

// The list/detail projection, selected from the `devices` source. Keys map
// 1:1 onto the snake_case fields `toDevice` reads.
const deviceColumns = [
  "devices.id",
  "devices.organization_id",
  "devices.apple_team_id",
  "devices.identifier",
  "devices.name",
  "devices.model",
  "devices.device_class",
  "devices.enabled",
  "devices.apple_device_portal_id",
  "devices.created_at",
  "devices.updated_at",
] as const;

// FTS5 trigram tokenizer requires 3+ char queries. Wrap in phrase quotes so
// Special chars (-, ", *, etc.) are treated as literal text rather than FTS
// Operators. Doubling embedded quotes is the standard FTS5 escape.
const escapeFtsPhrase = (value: string): string => `"${value.replaceAll('"', '""')}"`;

// Search predicate: FTS5 MATCH (via a correlated EXISTS over `devices_fts`) for
// 3+ char queries, falling back to a LIKE substring scan on name/identifier for
// shorter queries the trigram index can't tokenize. `null` when there is
// nothing to filter on.
const searchExpression = (
  eb: ExpressionBuilder<DB, "devices">,
  query: string | undefined,
): Expression<SqlBool> | null => {
  if (query === undefined || query.length === 0) {
    return null;
  }
  if (query.length >= 3) {
    return eb.exists(
      eb
        .selectFrom("devices_fts")
        .select(sql`1`.as("present"))
        .whereRef("devices_fts.device_id", "=", "devices.id")
        .where(sql<SqlBool>`"devices_fts" MATCH ${escapeFtsPhrase(query)}`),
    );
  }
  // Trigram FTS can't index 1-2 char tokens; LIKE keeps short queries usable.
  const pattern = `%${query.toLowerCase()}%`;
  return eb.or([
    eb(eb.fn<string>("lower", ["devices.name"]), "like", pattern),
    eb(eb.fn<string>("lower", ["devices.identifier"]), "like", pattern),
  ]);
};

// Binding scope (GITLAB-RBAC-SPEC §1a): `undefined` = admin tier (no scope);
// an empty list matches nothing (a member with zero readable teams).
const teamScopeExpression = (
  eb: ExpressionBuilder<DB, "devices">,
  appleTeamIdIn: readonly string[] | undefined,
): Expression<SqlBool> | null => {
  if (appleTeamIdIn === undefined) {
    return null;
  }
  if (appleTeamIdIn.length === 0) {
    return sql<SqlBool>`0`;
  }
  return eb("devices.apple_team_id", "in", [...appleTeamIdIn]);
};

// Combine the always-present org scope with the optional class / team / search
// predicates. SECURITY: only the search *value* is user-controlled; it is
// parameterized by `sql`/the query builder, never concatenated.
const deviceFilter =
  (filters: {
    readonly organizationId: string;
    readonly deviceClass: readonly DeviceClass[] | undefined;
    readonly appleTeamId: readonly string[] | undefined;
    readonly appleTeamIdIn: readonly string[] | undefined;
    readonly query: string | undefined;
  }) =>
  (eb: ExpressionBuilder<DB, "devices">): Expression<SqlBool> => {
    const conditions = [
      eb("devices.organization_id", "=", filters.organizationId),
      filters.deviceClass === undefined || filters.deviceClass.length === 0
        ? null
        : eb("devices.device_class", "in", [...filters.deviceClass]),
      filters.appleTeamId === undefined || filters.appleTeamId.length === 0
        ? null
        : eb("devices.apple_team_id", "in", [...filters.appleTeamId]),
      teamScopeExpression(eb, filters.appleTeamIdIn),
      searchExpression(eb, filters.query),
    ].filter((condition): condition is Expression<SqlBool> => condition !== null);
    return eb.and(conditions);
  };

// Sort whitelist → ORDER BY expression. `name` collates case-insensitively. The
// trailing `devices.id` tie-break that keeps pagination stable is applied at the
// call site.
const sortColumns = {
  name: sql`"devices"."name" collate nocase`,
  createdAt: sql`"devices"."created_at"`,
  deviceClass: sql`"devices"."device_class"`,
} satisfies Record<DeviceSortKey, unknown>;

const toDevice = (row: DeviceRow): DeviceModel => ({
  id: row.id,
  organizationId: row.organization_id,
  appleTeamId: row.apple_team_id,
  identifier: row.identifier,
  name: row.name,
  model: row.model,
  deviceClass: row.device_class,
  enabled: row.enabled === 1,
  appleDevicePortalId: row.apple_device_portal_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const DeviceRepoLive = Layer.succeed(DeviceRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* d1RunWithUniqueCheck(
        async () =>
          db
            .insertInto("devices")
            .values({
              id: params.id,
              organization_id: params.organizationId,
              apple_team_id: params.appleTeamId,
              identifier: params.identifier,
              name: params.name,
              model: params.model,
              device_class: params.deviceClass,
              enabled: params.enabled ? 1 : 0,
              apple_device_portal_id: params.appleDevicePortalId,
              created_at: params.createdAt,
              updated_at: params.updatedAt,
            })
            .execute(),
        `A device with identifier "${params.identifier}" is already registered`,
      );
    }),

  findByOrg: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const where = deviceFilter({
        organizationId: params.organizationId,
        deviceClass: params.deviceClass,
        appleTeamId: params.appleTeamId,
        appleTeamIdIn: params.appleTeamIdIn,
        query: params.query,
      });

      const countRow = yield* Effect.promise(async () =>
        db
          .selectFrom("devices")
          .where(where)
          .select((eb) => eb.fn.countAll<number>().as("count"))
          .executeTakeFirstOrThrow(),
      );
      const total = countRow.count;

      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("devices")
          .where(where)
          .select(deviceColumns)
          .$narrowType<{ id: NotNull }>()
          .orderBy(sortColumns[params.sort], params.order)
          .orderBy("devices.id", params.order)
          .limit(params.limit)
          .offset(params.offset)
          .execute(),
      );

      return { items: rows.map(toDevice), total };
    }),

  findAllByOrg: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("devices")
          .select(deviceColumns)
          .$narrowType<{ id: NotNull }>()
          .where(
            deviceFilter({
              organizationId: params.organizationId,
              deviceClass: undefined,
              appleTeamId: params.appleTeamId === undefined ? undefined : [params.appleTeamId],
              appleTeamIdIn: undefined,
              query: undefined,
            }),
          )
          .orderBy("devices.created_at", "desc")
          .execute(),
      );
      return rows.map(toDevice);
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("devices")
          .select(deviceColumns)
          .$narrowType<{ id: NotNull }>()
          .where("devices.id", "=", params.id)
          .executeTakeFirst(),
      );
      if (!row) {
        return yield* new NotFound({ message: "Device not found" });
      }
      return toDevice(row);
    }),

  findByIdentifier: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("devices")
          .select(deviceColumns)
          .$narrowType<{ id: NotNull }>()
          .where("devices.organization_id", "=", params.organizationId)
          .where(
            sql<SqlBool>`coalesce("devices"."apple_team_id", '') = coalesce(${params.appleTeamId}, '')`,
          )
          .where("devices.identifier", "=", params.identifier)
          .executeTakeFirst(),
      );
      if (!row) {
        return yield* new NotFound({ message: "Device not found" });
      }
      return toDevice(row);
    }),

  update: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const patch = compact({
        name: params.name,
        enabled: typeof params.enabled === "boolean" ? Number(params.enabled) : undefined,
        apple_team_id: params.appleTeamId,
        updated_at: params.updatedAt,
      });

      yield* d1RunWithUniqueCheck(
        async () => db.updateTable("devices").set(patch).where("id", "=", params.id).execute(),
        `A device with this identifier is already registered in the target team`,
      );
    }),

  setApplePortalId: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .updateTable("devices")
          .set({ apple_device_portal_id: params.appleDevicePortalId, updated_at: params.updatedAt })
          .where("id", "=", params.id)
          .execute(),
      );
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db.deleteFrom("devices").where("id", "=", params.id).execute(),
      );
    }),
});
