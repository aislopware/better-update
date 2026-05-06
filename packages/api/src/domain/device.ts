import { Schema } from "effect";

import { DateTimeString, Id, PaginationParams } from "./common";

export const DeviceClass = Schema.Literal("IPHONE", "IPAD", "MAC", "UNKNOWN");
export type DeviceClassValue = typeof DeviceClass.Type;

const IDENTIFIER_PATTERN =
  /^(?:[A-Fa-f0-9]{40}|[A-Fa-f0-9]{8}-[A-Fa-f0-9]{16}|[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12})$/u;

export const DeviceIdentifier = Schema.String.pipe(
  Schema.pattern(IDENTIFIER_PATTERN, {
    message: () =>
      "Identifier must be an Apple UDID: 40 hex chars, 8-16 hex, or UUID (8-4-4-4-12 hex)",
  }),
);

export class Device extends Schema.Class<Device>("Device")({
  id: Id,
  organizationId: Id,
  appleTeamId: Schema.NullOr(Id),
  identifier: Schema.String,
  name: Schema.String,
  model: Schema.NullOr(Schema.String),
  deviceClass: DeviceClass,
  enabled: Schema.Boolean,
  appleDevicePortalId: Schema.NullOr(Schema.String),
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}) {}

export const RegisterDeviceBody = Schema.Struct({
  identifier: DeviceIdentifier,
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(120)),
  deviceClass: DeviceClass,
  model: Schema.optional(Schema.String.pipe(Schema.maxLength(120))),
  appleTeamId: Schema.optional(Id),
});

export const UpdateDeviceBody = Schema.Struct({
  name: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(120))),
  enabled: Schema.optional(Schema.Boolean),
  appleTeamId: Schema.optional(Schema.NullOr(Id)),
});

export const DeleteDeviceResult = Schema.Struct({ deleted: Schema.Number });

export const DeviceSortColumn = Schema.Literal("name", "createdAt", "deviceClass");

/**
 * Sort param: column name optionally prefixed with `-` for descending.
 * Example: `name` (asc), `-createdAt` (desc).
 */
export const DeviceSort = Schema.Union(
  DeviceSortColumn,
  Schema.TemplateLiteral("-", DeviceSortColumn),
);

export const ListDevicesParams = Schema.Struct({
  ...PaginationParams.fields,
  deviceClass: Schema.optional(DeviceClass),
  appleTeamId: Schema.optional(Id),
  query: Schema.optional(Schema.String),
  sort: Schema.optional(DeviceSort),
});

export class DeviceRegistrationRequest extends Schema.Class<DeviceRegistrationRequest>(
  "DeviceRegistrationRequest",
)({
  id: Id,
  organizationId: Id,
  appleTeamId: Schema.NullOr(Id),
  deviceNameHint: Schema.NullOr(Schema.String),
  deviceClassHint: Schema.NullOr(DeviceClass),
  url: Schema.String,
  expiresAt: DateTimeString,
  consumedAt: Schema.NullOr(DateTimeString),
  consumedDeviceId: Schema.NullOr(Id),
  createdAt: DateTimeString,
}) {}

export const CreateRegistrationRequestBody = Schema.Struct({
  deviceNameHint: Schema.optional(Schema.String.pipe(Schema.maxLength(120))),
  deviceClassHint: Schema.optional(DeviceClass),
  ttlHours: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(1, 168))),
  appleTeamId: Schema.optional(Id),
});

export const ListRegistrationRequestsParams = Schema.Struct({
  active: Schema.optional(Schema.Literal("true", "false")),
  appleTeamId: Schema.optional(Id),
});
