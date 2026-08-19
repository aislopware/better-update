import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { idParam, pageResult } from "../domain/common";
import {
  CreateRegistrationRequestBody,
  DeleteDeviceResult,
  Device,
  DeviceRegistrationRequest,
  ListDevicesParams,
  ListRegistrationRequestsParams,
  RegisterDeviceBody,
  SyncDevicesBody,
  SyncDevicesResult,
  UpdateDeviceBody,
} from "../domain/device";
import { Conflict } from "../domain/errors";

export const DevicesGroup = HttpApiGroup.make("devices")
  .add(
    HttpApiEndpoint.post("register", "/api/devices", {
      payload: RegisterDeviceBody,
      success: Device.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Register device",
        description: "Register an Apple device UDID in the caller's active organization",
      }),
    ),
    HttpApiEndpoint.get("list", "/api/devices", {
      query: ListDevicesParams,
      success: pageResult(Device),
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List devices",
        description: "List registered Apple devices in the caller's active organization",
      }),
    ),
    HttpApiEndpoint.get("get", "/api/devices/:id", {
      params: { ...idParam },
      success: Device,
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Get device",
        description: "Get a single device by ID",
      }),
    ),
    HttpApiEndpoint.patch("update", "/api/devices/:id", {
      params: { ...idParam },
      payload: UpdateDeviceBody,
      success: Device,
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Update device",
        description: "Rename a device or toggle its enabled state",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("delete", "/api/devices/:id", {
      params: { ...idParam },
      success: DeleteDeviceResult,
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Delete device",
        description: "Remove a registered device from the organization",
      }),
    ),
    HttpApiEndpoint.post("syncDevices", "/api/devices/sync", {
      payload: SyncDevicesBody,
      success: SyncDevicesResult,
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Sync devices with App Store Connect",
        description:
          "Reconcile the org's device roster for one Apple team against an App Store Connect snapshot: link Apple portal ids onto existing devices and import devices that only exist on Apple",
      }),
    ),
    HttpApiEndpoint.post("createRegistrationRequest", "/api/devices/registration-requests", {
      payload: CreateRegistrationRequestBody,
      success: DeviceRegistrationRequest.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Create device registration request",
        description:
          "Generate a URL + QR code for self-service device enrollment via Safari on iOS",
      }),
    ),
    HttpApiEndpoint.get("listRegistrationRequests", "/api/devices/registration-requests", {
      query: ListRegistrationRequestsParams,
      success: Schema.Struct({
        items: Schema.Array(DeviceRegistrationRequest),
      }),
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List device registration requests",
        description: "List outstanding device registration invites",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Devices",
      description: "Apple device management for ad-hoc builds",
    }),
  );
