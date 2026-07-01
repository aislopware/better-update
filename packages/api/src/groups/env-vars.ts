import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";
import { Schema } from "effect";

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

export class EnvVarsGroup extends HttpApiGroup.make("env-vars")
  .add(
    HttpApiEndpoint.post("create", "/api/env-vars")
      .setPayload(CreateEnvVarBody)
      .addSuccess(EnvVar, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Create environment variable",
          description:
            "Create a new environment variable for one environment. The body carries the client-sealed value envelope; the server never sees plaintext. Scope can be 'project' (requires projectId) or 'global'.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("list", "/api/env-vars")
      .setUrlParams(
        Schema.Struct({
          scope: Schema.optional(EnvVarListScope),
          projectId: Schema.optional(Id),
          environments: Schema.optional(Schema.String),
          search: Schema.optional(Schema.String),
          ...PaginationParams.fields,
        }),
      )
      .addSuccess(
        Schema.Struct({
          items: Schema.Array(EnvVar),
        }),
      )
      .annotateContext(
        OpenApi.annotations({
          title: "List environment variables",
          description:
            "List environment variable metadata (no values — those are encrypted). scope=all merges project + global vars with project overrides. environments is a comma-separated list. search matches key substring.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("get")`/api/env-vars/${idParam}`.addSuccess(EnvVar).annotateContext(
      OpenApi.annotations({
        title: "Get environment variable",
        description: "Get an environment variable's metadata by ID (no value)",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("getValue")`/api/env-vars/${idParam}/value`
      .addSuccess(EnvVarValueEnvelope)
      .annotateContext(
        OpenApi.annotations({
          title: "Get sealed env-var value",
          description:
            "Return the active value's sealed envelope (ciphertext, wrapped DEK, vault version) for client-side decryption in the browser env-vault. Browser (cookie) callers must first complete a WebAuthn step-up; CLI bearer callers use the bulk export instead.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.patch("update")`/api/env-vars/${idParam}`
      .setPayload(UpdateEnvVarBody)
      .addSuccess(EnvVar)
      .annotateContext(
        OpenApi.annotations({
          title: "Update environment variable",
          description:
            "Change the value (a new sealed revision) and/or the visibility tier. The environment is immutable.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("upsertDescription", "/api/env-vars/description")
      .setPayload(UpsertEnvVarDescriptionBody)
      .addSuccess(EnvVarDescription)
      .annotateContext(
        OpenApi.annotations({
          title: "Set variable documentation",
          description:
            "Upsert a variable's human-readable label + description, keyed by (scope, key) and shared across every environment. Non-secret metadata: needs the envVar:update permission but no vault access or WebAuthn step-up. Send null to clear a field, omit to leave it unchanged.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/env-vars/${idParam}`
      .addSuccess(DeleteEnvVarResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete environment variable",
          description: "Delete an environment variable and all of its value revisions",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("revisions")`/api/env-vars/${idParam}/revisions`
      .addSuccess(EnvVarRevisionsResult)
      .annotateContext(
        OpenApi.annotations({
          title: "List value revisions",
          description: "List a variable's value history (metadata only, newest first)",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("rollback")`/api/env-vars/${idParam}/rollback`
      .setPayload(RollbackEnvVarBody)
      .addSuccess(EnvVar)
      .annotateContext(
        OpenApi.annotations({
          title: "Roll back to a revision",
          description: "Re-point the active value at an earlier revision of this variable",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("bulkImport", "/api/env-vars/bulk-import")
      .setPayload(BulkImportEnvVarsBody)
      .addSuccess(BulkImportResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Bulk import environment variables",
          description:
            "Upsert pre-sealed entries (one per key+environment). The CLI parses the dotenv file and seals each value locally before sending.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("export", "/api/env-vars/export")
      .setUrlParams(
        Schema.Struct({
          projectId: Id,
          environment: EnvVarEnvironment,
        }),
      )
      .addSuccess(EnvVarExportResult)
      .addError(Forbidden)
      .annotateContext(
        OpenApi.annotations({
          title: "Export environment variables",
          description:
            "Export sealed value envelopes for a project environment (CLI decrypts locally). Global org-scoped vars are merged in; project values override globals on key collision. Bearer (CLI/API-key) auth only.",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Forbidden)
  .addError(BadRequest)
  .addError(Conflict)
  .annotateContext(
    OpenApi.annotations({
      title: "Environment Variables",
      description:
        "Manage end-to-end encrypted, versioned environment variables for project builds",
    }),
  ) {}
