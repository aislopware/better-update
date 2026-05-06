import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  CreateRegistrationRequestBody,
  DeleteDeviceResult,
  Device,
  DeviceRegistrationRequest,
  ListDevicesParams,
  ListRegistrationRequestsParams,
  RegisterDeviceBody,
  UpdateDeviceBody,
} from "../domain/device";
import { Conflict } from "../domain/errors";

const idParam = HttpApiSchema.param("id", Schema.String);

export class DevicesGroup extends HttpApiGroup.make("devices")
  .add(
    HttpApiEndpoint.post("register", "/api/devices")
      .setPayload(RegisterDeviceBody)
      .addSuccess(Device, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Register device",
          description: "Register an Apple device UDID in the caller's active organization",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("list", "/api/devices")
      .setUrlParams(ListDevicesParams)
      .addSuccess(
        Schema.Struct({
          items: Schema.Array(Device),
          total: Schema.Number,
          page: Schema.Number,
          limit: Schema.Number,
        }),
      )
      .annotateContext(
        OpenApi.annotations({
          title: "List devices",
          description: "List registered Apple devices in the caller's active organization",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("get")`/api/devices/${idParam}`.addSuccess(Device).annotateContext(
      OpenApi.annotations({
        title: "Get device",
        description: "Get a single device by ID",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("update")`/api/devices/${idParam}`
      .setPayload(UpdateDeviceBody)
      .addSuccess(Device)
      .annotateContext(
        OpenApi.annotations({
          title: "Update device",
          description: "Rename a device or toggle its enabled state",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/devices/${idParam}`
      .addSuccess(DeleteDeviceResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete device",
          description: "Remove a registered device from the organization",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("createRegistrationRequest", "/api/devices/registration-requests")
      .setPayload(CreateRegistrationRequestBody)
      .addSuccess(DeviceRegistrationRequest, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Create device registration request",
          description:
            "Generate a URL + QR code for self-service device enrollment via Safari on iOS",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("listRegistrationRequests", "/api/devices/registration-requests")
      .setUrlParams(ListRegistrationRequestsParams)
      .addSuccess(
        Schema.Struct({
          items: Schema.Array(DeviceRegistrationRequest),
        }),
      )
      .annotateContext(
        OpenApi.annotations({
          title: "List device registration requests",
          description: "List outstanding device registration invites",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Devices",
      description: "Apple device management for ad-hoc builds",
    }),
  ) {}
