import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { NotFound } from "../errors";
import { d1RunWithUniqueCheck } from "./d1-helpers";

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
    readonly deviceClass?: DeviceClass | undefined;
    readonly appleTeamId?: string | undefined;
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

interface DeviceRow {
  id: string;
  organization_id: string;
  apple_team_id: string | null;
  identifier: string;
  name: string;
  model: string | null;
  device_class: DeviceClass;
  enabled: number;
  apple_device_portal_id: string | null;
  created_at: string;
  updated_at: string;
}

const DEVICE_COLUMNS = `d."id", d."organization_id", d."apple_team_id", d."identifier", d."name", d."model", d."device_class", d."enabled", d."apple_device_portal_id", d."created_at", d."updated_at"`;

// FTS5 trigram tokenizer requires 3+ char queries. Wrap in phrase quotes so
// Special chars (-, ", *, etc.) are treated as literal text rather than FTS
// Operators. Doubling embedded quotes is the standard FTS5 escape.
const escapeFtsPhrase = (value: string): string => `"${value.replaceAll('"', '""')}"`;

interface DeviceSearchClause {
  readonly join: string;
  readonly where: string;
  readonly binds: readonly string[];
}

const buildDeviceSearchClause = (query: string | undefined): DeviceSearchClause | null => {
  if (query === undefined || query.length === 0) {
    return null;
  }
  if (query.length >= 3) {
    return {
      join: 'JOIN "devices_fts" ON "devices_fts"."device_id" = d."id"',
      where: '"devices_fts" MATCH ?',
      binds: [escapeFtsPhrase(query)],
    };
  }
  // Trigram FTS can't index 1-2 char tokens; LIKE keeps short queries usable.
  const pattern = `%${query.toLowerCase()}%`;
  return {
    join: "",
    where: '(LOWER(d."name") LIKE ? OR LOWER(d."identifier") LIKE ?)',
    binds: [pattern, pattern],
  };
};

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
      const env = yield* cloudflareEnv;
      yield* d1RunWithUniqueCheck(
        async () =>
          env.DB.prepare(
            `INSERT INTO "devices" ("id", "organization_id", "apple_team_id", "identifier", "name", "model", "device_class", "enabled", "apple_device_portal_id", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
            .bind(
              params.id,
              params.organizationId,
              params.appleTeamId,
              params.identifier,
              params.name,
              params.model,
              params.deviceClass,
              params.enabled ? 1 : 0,
              params.appleDevicePortalId,
              params.createdAt,
              params.updatedAt,
            )
            .run(),
        `A device with identifier "${params.identifier}" is already registered`,
      );
    }),

  findByOrg: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      // SECURITY: All condition strings are hardcoded literals. Never interpolate user input into conditions.
      const filters: string[] = [`d."organization_id" = ?`];
      const bindings: (string | number)[] = [params.organizationId];

      if (params.deviceClass !== undefined) {
        filters.push(`d."device_class" = ?`);
        bindings.push(params.deviceClass);
      }
      if (params.appleTeamId !== undefined) {
        filters.push(`d."apple_team_id" = ?`);
        bindings.push(params.appleTeamId);
      }

      const search = buildDeviceSearchClause(params.query);
      if (search) {
        filters.push(search.where);
        bindings.push(...search.binds);
      }

      const joinClause = search ? ` ${search.join}` : "";
      const whereClause = filters.join(" AND ");

      const sortColumns: Record<DeviceSortKey, string> = {
        name: 'd."name" COLLATE NOCASE',
        createdAt: 'd."created_at"',
        deviceClass: 'd."device_class"',
      };
      const direction = params.order === "asc" ? "ASC" : "DESC";
      const orderBy = `${sortColumns[params.sort]} ${direction}, d."id" ${direction}`;

      const countResult = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT COUNT(*) as count FROM "devices" d${joinClause} WHERE ${whereClause}`,
        )
          .bind(...bindings)
          .first<{ count: number }>(),
      );
      const total = countResult?.count ?? 0;

      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${DEVICE_COLUMNS} FROM "devices" d${joinClause} WHERE ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
        )
          .bind(...bindings, params.limit, params.offset)
          .all<DeviceRow>(),
      );

      return { items: rows.results.map(toDevice), total };
    }),

  findAllByOrg: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const filters: string[] = [`d."organization_id" = ?`];
      const bindings: (string | number)[] = [params.organizationId];
      if (params.appleTeamId !== undefined) {
        filters.push(`d."apple_team_id" = ?`);
        bindings.push(params.appleTeamId);
      }
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${DEVICE_COLUMNS} FROM "devices" d WHERE ${filters.join(" AND ")} ORDER BY d."created_at" DESC`,
        )
          .bind(...bindings)
          .all<DeviceRow>(),
      );
      return rows.results.map(toDevice);
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT ${DEVICE_COLUMNS} FROM "devices" d WHERE d."id" = ?`)
          .bind(params.id)
          .first<DeviceRow>(),
      );
      if (row === null) {
        return yield* new NotFound({ message: "Device not found" });
      }
      return toDevice(row);
    }),

  findByIdentifier: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${DEVICE_COLUMNS} FROM "devices" d WHERE d."organization_id" = ? AND COALESCE(d."apple_team_id", '') = COALESCE(?, '') AND d."identifier" = ?`,
        )
          .bind(params.organizationId, params.appleTeamId, params.identifier)
          .first<DeviceRow>(),
      );
      if (row === null) {
        return yield* new NotFound({ message: "Device not found" });
      }
      return toDevice(row);
    }),

  update: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const sets: string[] = [`"updated_at" = ?`];
      const bindings: (string | number | null)[] = [params.updatedAt];

      if (params.name !== undefined) {
        sets.push(`"name" = ?`);
        bindings.push(params.name);
      }
      if (params.enabled !== undefined) {
        sets.push(`"enabled" = ?`);
        bindings.push(params.enabled ? 1 : 0);
      }
      if (params.appleTeamId !== undefined) {
        sets.push(`"apple_team_id" = ?`);
        bindings.push(params.appleTeamId);
      }

      bindings.push(params.id);

      yield* d1RunWithUniqueCheck(
        async () =>
          env.DB.prepare(`UPDATE "devices" SET ${sets.join(", ")} WHERE "id" = ?`)
            .bind(...bindings)
            .run(),
        `A device with this identifier is already registered in the target team`,
      );
    }),

  setApplePortalId: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.DB.prepare(
          `UPDATE "devices" SET "apple_device_portal_id" = ?, "updated_at" = ? WHERE "id" = ?`,
        )
          .bind(params.appleDevicePortalId, params.updatedAt, params.id)
          .run(),
      );
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.DB.prepare(`DELETE FROM "devices" WHERE "id" = ?`).bind(params.id).run(),
      );
    }),
});
