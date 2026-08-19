import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

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

export const AscApiKeysGroup = HttpApiGroup.make("ascApiKeys")
  .add(
    HttpApiEndpoint.get("list", "/api/apple/asc-api-keys", {
      success: Schema.Struct({ items: Schema.Array(AscApiKey) }),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List App Store Connect API keys",
        description: "List stored ASC API keys for the organization",
      }),
    ),
    HttpApiEndpoint.post("upload", "/api/apple/asc-api-keys", {
      payload: UploadAscApiKeyBody,
      success: AscApiKey.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Upload ASC API key",
        description: "Upload an App Store Connect API key (.p8 + issuer)",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("delete", "/api/apple/asc-api-keys/:id", {
      params: { ...idParam },
      success: DeleteAscApiKeyResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Delete ASC API key",
        description: "Remove a stored ASC API key",
      }),
    ),
    HttpApiEndpoint.get("getCredentials", "/api/apple/asc-api-keys/:id/credentials", {
      params: { ...idParam },
      success: AscApiKeyCredentials,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Get ASC API key credentials",
        description:
          "Return the encrypted .p8 envelope, keyId, issuerId, and Apple team; the CLI decrypts locally for direct App Store Connect API calls",
      }),
    ),
    HttpApiEndpoint.put("protect", "/api/apple/asc-api-keys/:id/protection", {
      params: { ...idParam },
      success: AscApiKey,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Protect credential",
        description:
          "Mark the ASC API key protected (GITLAB-RBAC-SPEC §3b): reads/uses require Maintainer+. Org admin only. Idempotent.",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("unprotect", "/api/apple/asc-api-keys/:id/protection", {
      params: { ...idParam },
      success: AscApiKey,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Unprotect credential",
        description: "Remove the key's protection. Org admin only. Idempotent.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "App Store Connect API Keys",
      description: "Manage ASC API keys used for device + profile sync",
    }),
  );
