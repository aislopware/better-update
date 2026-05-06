import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { cloudflareEnv } from "../cloudflare/context";
import { normalizeIdentifier } from "../domain/device";
import { toApiDevice, toApiDeviceRegistrationRequest } from "../http/to-api";
import { toApiCrudEffect } from "../http/to-api-effect";
import { toDbNull } from "../lib/nullable";
import { parsePagination } from "../lib/pagination";
import { DeviceRegistrationRequestRepo } from "../repositories/device-registration-requests";
import { DeviceRepo } from "../repositories/devices";

import type { DeviceSortKey, DeviceSortOrder } from "../repositories/devices";

const parseDeviceSort = (
  value: string | undefined = "-createdAt",
): { readonly sort: DeviceSortKey; readonly order: DeviceSortOrder } => {
  const order: DeviceSortOrder = value.startsWith("-") ? "desc" : "asc";
  const column = value.startsWith("-") ? value.slice(1) : value;
  switch (column) {
    case "name":
    case "createdAt":
    case "deviceClass": {
      return { sort: column, order };
    }
    default: {
      return { sort: "createdAt", order: "desc" };
    }
  }
};

export const DevicesGroupLive = HttpApiBuilder.group(ManagementApi, "devices", (handlers) =>
  handlers
    .handle("register", ({ payload }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("device", "create");
          const ctx = yield* CurrentActor;
          const repo = yield* DeviceRepo;
          const id = crypto.randomUUID();
          const now = new Date().toISOString();
          const identifier = normalizeIdentifier(payload.identifier);

          const device = {
            id,
            organizationId: ctx.organizationId,
            appleTeamId: toDbNull(payload.appleTeamId),
            identifier,
            name: payload.name,
            model: toDbNull(payload.model),
            deviceClass: payload.deviceClass,
            enabled: true,
            appleDevicePortalId: null,
            createdAt: now,
            updatedAt: now,
          };

          yield* repo.insert(device);

          yield* logAudit({
            action: "device.register",
            resourceType: "device",
            resourceId: id,
            metadata: { identifier, deviceClass: payload.deviceClass, name: payload.name },
          });

          return toApiDevice(device);
        }),
      ),
    )
    .handle("list", ({ urlParams }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("device", "read");
          const ctx = yield* CurrentActor;
          const repo = yield* DeviceRepo;
          const { page, limit, offset } = parsePagination(urlParams);
          const { sort, order } = parseDeviceSort(urlParams.sort);

          const { items, total } = yield* repo.findByOrg({
            organizationId: ctx.organizationId,
            sort,
            order,
            limit,
            offset,
            deviceClass: urlParams.deviceClass,
            appleTeamId: urlParams.appleTeamId,
            query: urlParams.query,
          });

          return { items: items.map(toApiDevice), total, page, limit };
        }),
      ),
    )
    .handle("get", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("device", "read");
          const repo = yield* DeviceRepo;
          const device = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(device.organizationId);
          return toApiDevice(device);
        }),
      ),
    )
    .handle("update", ({ path, payload }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("device", "update");
          const repo = yield* DeviceRepo;
          const device = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(device.organizationId);

          const now = new Date().toISOString();
          yield* repo.update({
            id: path.id,
            name: payload.name,
            enabled: payload.enabled,
            appleTeamId: payload.appleTeamId,
            updatedAt: now,
          });

          const metadata: Record<string, unknown> = {};
          if (payload.name !== undefined) {
            metadata["name"] = payload.name;
          }
          if (payload.enabled !== undefined) {
            metadata["enabled"] = payload.enabled;
          }
          if (payload.appleTeamId !== undefined) {
            metadata["appleTeamId"] = payload.appleTeamId;
          }

          yield* logAudit({
            action: "device.update",
            resourceType: "device",
            resourceId: path.id,
            metadata,
          });

          return toApiDevice({
            ...device,
            name: payload.name === undefined ? device.name : payload.name,
            enabled: payload.enabled === undefined ? device.enabled : payload.enabled,
            appleTeamId:
              payload.appleTeamId === undefined ? device.appleTeamId : payload.appleTeamId,
            updatedAt: now,
          });
        }),
      ),
    )
    .handle("delete", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("device", "delete");
          const repo = yield* DeviceRepo;
          const device = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(device.organizationId);
          yield* repo.delete({ id: path.id });

          yield* logAudit({
            action: "device.delete",
            resourceType: "device",
            resourceId: path.id,
            metadata: { identifier: device.identifier },
          });

          return { deleted: 1 };
        }),
      ),
    )
    .handle("createRegistrationRequest", ({ payload }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("device", "create");
          const ctx = yield* CurrentActor;
          const repo = yield* DeviceRegistrationRequestRepo;
          const env = yield* cloudflareEnv;
          const origin = env.PUBLIC_API_URL;

          const id = crypto.randomUUID();
          const now = new Date();
          const ttlHours = payload.ttlHours ?? 24;
          const expiresAt = new Date(now.getTime() + ttlHours * 3_600_000).toISOString();
          const createdByUserId = ctx.userId ?? ctx.actorEmail;

          const model = {
            id,
            organizationId: ctx.organizationId,
            appleTeamId: toDbNull(payload.appleTeamId),
            createdByUserId,
            deviceNameHint: toDbNull(payload.deviceNameHint),
            deviceClassHint: toDbNull(payload.deviceClassHint),
            expiresAt,
            createdAt: now.toISOString(),
          };

          yield* repo.insert(model);

          yield* logAudit({
            action: "device.invite.create",
            resourceType: "device",
            resourceId: id,
            metadata: { expiresAt, ttlHours },
          });

          const url = `${origin}/register-device/${id}`;
          return toApiDeviceRegistrationRequest(
            { ...model, consumedAt: null, consumedDeviceId: null },
            url,
          );
        }),
      ),
    )
    .handle("listRegistrationRequests", ({ urlParams }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("device", "read");
          const ctx = yield* CurrentActor;
          const repo = yield* DeviceRegistrationRequestRepo;
          const env = yield* cloudflareEnv;
          const origin = env.PUBLIC_API_URL;
          const activeOnly = urlParams.active === "true";

          const items = yield* repo.findByOrg({
            organizationId: ctx.organizationId,
            activeOnly,
            now: new Date().toISOString(),
          });

          return {
            items: items.map((item) =>
              toApiDeviceRegistrationRequest(item, `${origin}/register-device/${item.id}`),
            ),
          };
        }),
      ),
    ),
);
