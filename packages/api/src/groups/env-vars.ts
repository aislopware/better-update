import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { Id, idParam, PaginationParams } from "../domain/common";
import {
  BulkImportEnvVarsBody,
  BulkImportResult,
  CreateEnvVarBody,
  DeleteEnvVarResult,
  EnvVar,
  EnvVarDescription,
  EnvVarEnvironment,
  EnvVarExportResult,
  EnvVarListScope,
  EnvVarRevisionsResult,
  EnvVarValueEnvelope,
  RollbackEnvVarBody,
  UpdateEnvVarBody,
  UpsertEnvVarDescriptionBody,
} from "../domain/env-var";
import { BadRequest, Conflict } from "../domain/errors";

export const EnvVarsGroup = HttpApiGroup.make("env-vars")
  .add(
    HttpApiEndpoint.post("create", "/api/env-vars", {
      payload: CreateEnvVarBody,
      success: EnvVar.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Forbidden, BadRequest, Conflict],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Create environment variable",
        description:
          "Create a new environment variable for one environment. The body carries the client-sealed value envelope; the server never sees plaintext. Scope can be 'project' (requires projectId) or 'global'.",
      }),
    ),
    HttpApiEndpoint.get("list", "/api/env-vars", {
      query: Schema.Struct({
        scope: Schema.optional(EnvVarListScope),
        projectId: Schema.optional(Id),
        environments: Schema.optional(Schema.String),
        search: Schema.optional(Schema.String),
        ...PaginationParams.fields,
      }),
      success: Schema.Struct({
        items: Schema.Array(EnvVar),
        // True when the requested page was full BEFORE per-environment readability
        // filtering — a short `items` array alone cannot signal the last page.
        // Optional so pre-existing servers (no field) read as "no more pages".
        hasMore: Schema.optional(Schema.Boolean),
      }),
      error: [NotFound, Forbidden, BadRequest, Conflict],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List environment variables",
        description:
          "List environment variable metadata (no values — those are encrypted). scope=all merges project + global vars with project overrides. environments is a comma-separated list. search matches key substring. hasMore signals further pages (readability filtering can shorten a page without ending the list).",
      }),
    ),
    HttpApiEndpoint.get("get", "/api/env-vars/:id", {
      params: { ...idParam },
      success: EnvVar,
      error: [NotFound, Forbidden, BadRequest, Conflict],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Get environment variable",
        description: "Get an environment variable's metadata by ID (no value)",
      }),
    ),
    HttpApiEndpoint.get("getValue", "/api/env-vars/:id/value", {
      params: { ...idParam },
      success: EnvVarValueEnvelope,
      error: [NotFound, Forbidden, BadRequest, Conflict],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Get sealed env-var value",
        description:
          "Return the active value's sealed envelope (ciphertext, wrapped DEK, vault version) for client-side decryption in the browser env-vault. Browser (cookie) callers must first complete a WebAuthn step-up; CLI bearer callers use the bulk export instead.",
      }),
    ),
    HttpApiEndpoint.patch("update", "/api/env-vars/:id", {
      params: { ...idParam },
      payload: UpdateEnvVarBody,
      success: EnvVar,
      error: [NotFound, Forbidden, BadRequest, Conflict],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Update environment variable",
        description:
          "Change the value (a new sealed revision) and/or the visibility tier. The environment is immutable.",
      }),
    ),
    HttpApiEndpoint.post("upsertDescription", "/api/env-vars/description", {
      payload: UpsertEnvVarDescriptionBody,
      success: EnvVarDescription,
      error: [NotFound, Forbidden, BadRequest, Conflict],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Set variable documentation",
        description:
          "Upsert a variable's human-readable label + description, keyed by (scope, key) and shared across every environment. Non-secret metadata: needs the envVar:update permission but no vault access or WebAuthn step-up. Send null to clear a field, omit to leave it unchanged.",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("delete", "/api/env-vars/:id", {
      params: { ...idParam },
      success: DeleteEnvVarResult,
      error: [NotFound, Forbidden, BadRequest, Conflict],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Delete environment variable",
        description: "Delete an environment variable and all of its value revisions",
      }),
    ),
    HttpApiEndpoint.get("revisions", "/api/env-vars/:id/revisions", {
      params: { ...idParam },
      success: EnvVarRevisionsResult,
      error: [NotFound, Forbidden, BadRequest, Conflict],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List value revisions",
        description: "List a variable's value history (metadata only, newest first)",
      }),
    ),
    HttpApiEndpoint.post("rollback", "/api/env-vars/:id/rollback", {
      params: { ...idParam },
      payload: RollbackEnvVarBody,
      success: EnvVar,
      error: [NotFound, Forbidden, BadRequest, Conflict],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Roll back to a revision",
        description: "Re-point the active value at an earlier revision of this variable",
      }),
    ),
    HttpApiEndpoint.post("bulkImport", "/api/env-vars/bulk-import", {
      payload: BulkImportEnvVarsBody,
      success: BulkImportResult,
      error: [NotFound, Forbidden, BadRequest, Conflict],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Bulk import environment variables",
        description:
          "Upsert pre-sealed entries (one per key+environment). The CLI parses the dotenv file and seals each value locally before sending.",
      }),
    ),
    HttpApiEndpoint.get("export", "/api/env-vars/export", {
      query: Schema.Struct({
        projectId: Id,
        environment: EnvVarEnvironment,
      }),
      success: EnvVarExportResult,
      error: [Forbidden, NotFound, BadRequest, Conflict],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Export environment variables",
        description:
          "Export sealed value envelopes for a project environment (CLI decrypts locally). Global org-scoped vars are merged in; project values override globals on key collision. Bearer (CLI/API-key) auth only.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Environment Variables",
      description:
        "Manage end-to-end encrypted, versioned environment variables for project builds",
    }),
  );
