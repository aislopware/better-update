import { Context, Effect, Layer } from "effect";

import type { Selectable } from "kysely";

import { kyselyDb } from "../cloudflare/db";
import { NotFound } from "../errors";

import type { DeviceRegistrationRequests } from "../db/schema";
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

const COLUMNS = [
  "id",
  "organization_id",
  "apple_team_id",
  "created_by_user_id",
  "device_name_hint",
  "device_class_hint",
  "expires_at",
  "consumed_at",
  "consumed_device_id",
  "created_at",
] as const;

const toModel = (row: Selectable<DeviceRegistrationRequests>): DeviceRegistrationRequestModel => ({
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
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .insertInto("device_registration_requests")
          .values({
            id: params.id,
            organization_id: params.organizationId,
            apple_team_id: params.appleTeamId,
            created_by_user_id: params.createdByUserId,
            device_name_hint: params.deviceNameHint,
            device_class_hint: params.deviceClassHint,
            expires_at: params.expiresAt,
            created_at: params.createdAt,
          })
          .execute(),
      );
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("device_registration_requests")
          .select(COLUMNS)
          .where("id", "=", params.id)
          .executeTakeFirst(),
      );
      if (row === undefined) {
        return yield* new NotFound({ message: "Registration request not found" });
      }
      return toModel(row);
    }),

  findByOrg: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const query = db
        .selectFrom("device_registration_requests")
        .select(COLUMNS)
        .where("organization_id", "=", params.organizationId)
        .$if(params.activeOnly, (qb) =>
          qb.where("consumed_at", "is", null).where("expires_at", ">", params.now),
        );

      const rows = yield* Effect.promise(async () => query.orderBy("created_at", "desc").execute());
      return rows.map(toModel);
    }),

  markConsumed: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .updateTable("device_registration_requests")
          .set({
            consumed_at: params.consumedAt,
            consumed_device_id: params.consumedDeviceId,
          })
          .where("id", "=", params.id)
          .execute(),
      );
    }),
});
