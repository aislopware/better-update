import { Schema } from "effect";

import {
  csvList,
  DateTimeString,
  DeletedResult,
  Id,
  Name120,
  PaginationParams,
  sortParam,
} from "./common";

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

/**
 * Canonical form of a device roster for staleness fingerprinting: UDIDs
 * normalized (trim + lowercase), deduplicated, sorted, comma-joined. Both the
 * server (`checkProfileStale`) and the CLI (profile generation) hash this exact
 * string — UDIDs, not Apple portal record ids, because Apple can hold several
 * portal records for one physical device while our roster keys by UDID.
 */
export const canonicalDeviceRoster = (identifiers: readonly string[]): string =>
  [...new Set(identifiers.map((identifier) => identifier.trim().toLowerCase()))]
    .toSorted()
    .join(",");

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
  name: Name120,
  deviceClass: DeviceClass,
  model: Schema.optional(Schema.String.pipe(Schema.maxLength(120))),
  appleTeamId: Schema.optional(Id),
});

export const UpdateDeviceBody = Schema.Struct({
  name: Schema.optional(Name120),
  enabled: Schema.optional(Schema.Boolean),
  appleTeamId: Schema.optional(Schema.NullOr(Id)),
});

/**
 * One device in an App Store Connect snapshot, as reconciled by `syncDevices`.
 * `appleDevicePortalId` is the device's id on Apple's portal — its presence is
 * what the dashboard surfaces as "synced".
 */
const SyncDeviceEntry = Schema.Struct({
  identifier: DeviceIdentifier,
  name: Name120,
  deviceClass: DeviceClass,
  appleDevicePortalId: Schema.String,
});

/**
 * Reconcile the org's device roster for one Apple team against a snapshot of
 * App Store Connect devices: link portal ids onto existing rows and import any
 * device that only exists on Apple. `appleTeamId` is the internal team Id (UUID).
 */
export const SyncDevicesBody = Schema.Struct({
  appleTeamId: Id,
  devices: Schema.Array(SyncDeviceEntry),
});

export const SyncDevicesResult = Schema.Struct({
  /** Devices that existed only on Apple and were imported locally. */
  created: Schema.Number,
  /** Local devices that gained (or changed) their Apple portal id. */
  linked: Schema.Number,
  /** Local devices already in sync — nothing to do. */
  unchanged: Schema.Number,
});

export const DeleteDeviceResult = DeletedResult;

export const DeviceSortColumn = Schema.Literal("name", "createdAt", "deviceClass");

export const DeviceSort = sortParam(DeviceSortColumn);

export const ListDevicesParams = Schema.Struct({
  ...PaginationParams.fields,
  deviceClass: Schema.optional(csvList(DeviceClass)),
  appleTeamId: Schema.optional(csvList(Id)),
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
