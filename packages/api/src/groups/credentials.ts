import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { Id, PaginationParams, Platform } from "../domain/common";
import {
  Credential,
  CreateCredentialBody,
  CredentialDownload,
  DeleteCredentialResult,
} from "../domain/credential";
import { BadRequest } from "../domain/errors";

const idParam = HttpApiSchema.param("id", Schema.String);

export class CredentialsGroup extends HttpApiGroup.make("credentials")
  .add(
    HttpApiEndpoint.post("upload", "/api/credentials")
      .setPayload(CreateCredentialBody)
      .addSuccess(Credential, { status: 201 })
      .addError(BadRequest)
      .annotateContext(
        OpenApi.annotations({
          title: "Upload credential",
          description: "Upload a new signing credential to the vault",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("list", "/api/credentials")
      .setUrlParams(
        Schema.Struct({
          projectId: Schema.optional(Id),
          platform: Schema.optional(Platform),
          type: Schema.optional(Schema.String),
          distribution: Schema.optional(Schema.String),
          ...PaginationParams.fields,
        }),
      )
      .addSuccess(
        Schema.Struct({
          items: Schema.Array(Credential),
          total: Schema.Number,
          page: Schema.Number,
          limit: Schema.Number,
        }),
      )
      .annotateContext(
        OpenApi.annotations({
          title: "List credentials",
          description: "List credentials with optional filters",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("get")`/api/credentials/${idParam}`.addSuccess(Credential).annotateContext(
      OpenApi.annotations({
        title: "Get credential",
        description: "Get a credential by ID",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("download")`/api/credentials/${idParam}/download`
      .addSuccess(CredentialDownload)
      .addError(Forbidden)
      .annotateContext(
        OpenApi.annotations({
          title: "Download credential",
          description: "Download credential blob with decrypted secrets",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("activate")`/api/credentials/${idParam}/activate`
      .addSuccess(Credential)
      .annotateContext(
        OpenApi.annotations({
          title: "Activate credential",
          description: "Activate a credential for use in builds",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/credentials/${idParam}`
      .addSuccess(DeleteCredentialResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete credential",
          description: "Delete a credential from the vault",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Forbidden)
  .addError(BadRequest)
  .annotateContext(
    OpenApi.annotations({
      title: "Credentials",
      description: "Credential vault for iOS and Android signing credentials",
    }),
  ) {}
