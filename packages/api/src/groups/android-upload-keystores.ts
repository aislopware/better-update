import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  AndroidUploadKeystore,
  DeleteAndroidUploadKeystoreResult,
  UploadAndroidUploadKeystoreBody,
} from "../domain/android-upload-keystore";
import { BadRequest, Conflict } from "../domain/errors";

const idParam = HttpApiSchema.param("id", Schema.String);

export class AndroidUploadKeystoresGroup extends HttpApiGroup.make("androidUploadKeystores")
  .add(
    HttpApiEndpoint.get("list", "/api/android/upload-keystores")
      .addSuccess(Schema.Struct({ items: Schema.Array(AndroidUploadKeystore) }))
      .annotateContext(
        OpenApi.annotations({
          title: "List Android upload keystores",
          description: "List uploaded Android keystores",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("upload", "/api/android/upload-keystores")
      .setPayload(UploadAndroidUploadKeystoreBody)
      .addSuccess(AndroidUploadKeystore, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Upload Android keystore",
          description: "Upload a JKS/PKCS12 keystore with key alias + passwords",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/android/upload-keystores/${idParam}`
      .addSuccess(DeleteAndroidUploadKeystoreResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete Android keystore",
          description: "Remove a stored Android keystore",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(BadRequest)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Android Upload Keystores",
      description: "Manage Android signing keystores",
    }),
  ) {}
