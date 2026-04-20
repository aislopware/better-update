import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  ApplePushKey,
  DeleteApplePushKeyResult,
  UploadApplePushKeyBody,
} from "../domain/apple-push-key";
import { BadRequest, Conflict } from "../domain/errors";

const idParam = HttpApiSchema.param("id", Schema.String);

export class ApplePushKeysGroup extends HttpApiGroup.make("applePushKeys")
  .add(
    HttpApiEndpoint.get("list", "/api/apple/push-keys")
      .addSuccess(Schema.Struct({ items: Schema.Array(ApplePushKey) }))
      .annotateContext(
        OpenApi.annotations({
          title: "List Apple push keys",
          description: "List APNs push keys for the organization",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("upload", "/api/apple/push-keys")
      .setPayload(UploadApplePushKeyBody)
      .addSuccess(ApplePushKey, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Upload push key",
          description: "Upload an APNs .p8 push notification key",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/apple/push-keys/${idParam}`
      .addSuccess(DeleteApplePushKeyResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete push key",
          description: "Remove a stored APNs push key",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(BadRequest)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Apple Push Keys",
      description: "Manage APNs push notification keys",
    }),
  ) {}
