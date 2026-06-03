import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { NotFound } from "../errors";

import type { DeviceClass, DeviceRegistrationRequestModel } from "../models";

// ── Port ──────────────────────────────────────────────────────────

export interface DeviceRegistrationRequestRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly appleTeamId: string | null;
    readonly createdByUserId: string;
    readonly deviceNameHint: string | null;
    readonly deviceClassHint: DeviceClass | null;
    readonly expiresAt: string;
    readonly createdAt: string;
  }) => Effect.Effect<void>;

  readonly findById: (params: {
    readonly id: string;
  }) => Effect.Effect<DeviceRegistrationRequestModel, NotFound>;

  readonly findByOrg: (params: {
    readonly organizationId: string;
    readonly activeOnly: boolean;
    readonly now: string;
  }) => Effect.Effect<readonly DeviceRegistrationRequestModel[]>;

  readonly markConsumed: (params: {
    readonly id: string;
    readonly consumedDeviceId: string;
    readonly consumedAt: string;
  }) => Effect.Effect<void>;
}

export class DeviceRegistrationRequestRepo extends Context.Tag("api/DeviceRegistrationRequestRepo")<
  DeviceRegistrationRequestRepo,
  DeviceRegistrationRequestRepository
>() {}

// ── D1 Adapter ────────────────────────────────────────────────────

interface Row {
  id: string;
  organization_id: string;
  apple_team_id: string | null;
  created_by_user_id: string;
  device_name_hint: string | null;
  device_class_hint: DeviceClass | null;
  expires_at: string;
  consumed_at: string | null;
  consumed_device_id: string | null;
  created_at: string;
}

const COLUMNS = `"id", "organization_id", "apple_team_id", "created_by_user_id", "device_name_hint", "device_class_hint", "expires_at", "consumed_at", "consumed_device_id", "created_at"`;

const toModel = (row: Row): DeviceRegistrationRequestModel => ({
  id: row.id,
  organizationId: row.organization_id,
  appleTeamId: row.apple_team_id,
  createdByUserId: row.created_by_user_id,
  deviceNameHint: row.device_name_hint,
  deviceClassHint: row.device_class_hint,
  expiresAt: row.expires_at,
  consumedAt: row.consumed_at,
  consumedDeviceId: row.consumed_device_id,
  createdAt: row.created_at,
});

export const DeviceRegistrationRequestRepoLive = Layer.succeed(DeviceRegistrationRequestRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.DB.prepare(
          `INSERT INTO "device_registration_requests" ("id", "organization_id", "apple_team_id", "created_by_user_id", "device_name_hint", "device_class_hint", "expires_at", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            params.id,
            params.organizationId,
            params.appleTeamId,
            params.createdByUserId,
            params.deviceNameHint,
            params.deviceClassHint,
            params.expiresAt,
            params.createdAt,
          )
          .run(),
      );
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT ${COLUMNS} FROM "device_registration_requests" WHERE "id" = ?`)
          .bind(params.id)
          .first<Row>(),
      );
      if (row === null) {
        return yield* new NotFound({ message: "Registration request not found" });
      }
      return toModel(row);
    }),

  findByOrg: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const where = params.activeOnly
        ? `WHERE "organization_id" = ? AND "consumed_at" IS NULL AND "expires_at" > ?`
        : `WHERE "organization_id" = ?`;
      const bindings = params.activeOnly
        ? [params.organizationId, params.now]
        : [params.organizationId];

      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${COLUMNS} FROM "device_registration_requests" ${where} ORDER BY "created_at" DESC`,
        )
          .bind(...bindings)
          .all<Row>(),
      );
      return rows.results.map(toModel);
    }),

  markConsumed: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.DB.prepare(
          `UPDATE "device_registration_requests" SET "consumed_at" = ?, "consumed_device_id" = ? WHERE "id" = ?`,
        )
          .bind(params.consumedAt, params.consumedDeviceId, params.id)
          .run(),
      );
    }),
});
