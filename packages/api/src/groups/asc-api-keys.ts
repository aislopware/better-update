import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  AscApiKey,
  AscApiKeyCredentials,
  DeleteAscApiKeyResult,
  UploadAscApiKeyBody,
} from "../domain/asc-api-key";
import { idParam } from "../domain/common";
import { BadRequest, Conflict } from "../domain/errors";

export class AscApiKeysGroup extends HttpApiGroup.make("ascApiKeys")
  .add(
    HttpApiEndpoint.get("list", "/api/apple/asc-api-keys")
      .addSuccess(Schema.Struct({ items: Schema.Array(AscApiKey) }))
      .annotateContext(
        OpenApi.annotations({
          title: "List App Store Connect API keys",
          description: "List stored ASC API keys for the organization",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("upload", "/api/apple/asc-api-keys")
      .setPayload(UploadAscApiKeyBody)
      .addSuccess(AscApiKey, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Upload ASC API key",
          description: "Upload an App Store Connect API key (.p8 + issuer)",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/apple/asc-api-keys/${idParam}`
      .addSuccess(DeleteAscApiKeyResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete ASC API key",
          description: "Remove a stored ASC API key",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("getCredentials")`/api/apple/asc-api-keys/${idParam}/credentials`
      .addSuccess(AscApiKeyCredentials)
      .annotateContext(
        OpenApi.annotations({
          title: "Get ASC API key credentials",
          description:
            "Return the encrypted .p8 envelope, keyId, issuerId, and Apple team; the CLI decrypts locally for direct App Store Connect API calls",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(BadRequest)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "App Store Connect API Keys",
      description: "Manage ASC API keys used for device + profile sync",
    }),
  ) {}
