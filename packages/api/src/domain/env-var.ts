import { Schema } from "effect";

import { DateTimeString, Id } from "./common";

export const EnvVarVisibility = Schema.Literal("plaintext", "sensitive");

export const EnvVarScope = Schema.Literal("project", "global");

export const EnvVarEnvironment = Schema.Literal("development", "preview", "production");

export const EnvVarListScope = Schema.Literal("all", "project", "global");

export class EnvVar extends Schema.Class<EnvVar>("EnvVar")({
  id: Id,
  organizationId: Id,
  projectId: Schema.NullOr(Id),
  scope: EnvVarScope,
  key: Schema.String,
  visibility: EnvVarVisibility,
  value: Schema.NullOr(Schema.String),
  environments: Schema.Array(EnvVarEnvironment),
  overridesGlobal: Schema.optional(Schema.Boolean),
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}) {}

// Key validation: uppercase letters, digits, underscores. Must start with letter.
const EnvVarKey = Schema.String.pipe(Schema.pattern(/^[A-Z][A-Z0-9_]*$/u), Schema.maxLength(256));

const EnvVarValue = Schema.String.pipe(Schema.maxLength(32_768));

const EnvVarEnvironmentArray = Schema.Array(EnvVarEnvironment).pipe(Schema.minItems(1));

export const CreateEnvVarBody = Schema.Struct({
  scope: EnvVarScope,
  projectId: Schema.optional(Id),
  environments: EnvVarEnvironmentArray,
  key: EnvVarKey,
  value: EnvVarValue,
  visibility: EnvVarVisibility,
});

export const UpdateEnvVarBody = Schema.Struct({
  value: Schema.optional(EnvVarValue),
  visibility: Schema.optional(EnvVarVisibility),
  environments: Schema.optional(EnvVarEnvironmentArray),
});

export const BulkImportEntry = Schema.Struct({
  key: EnvVarKey,
  value: EnvVarValue,
  visibility: Schema.optional(EnvVarVisibility),
});

export const BulkImportEnvVarsBody = Schema.Struct({
  scope: EnvVarScope,
  projectId: Schema.optional(Id),
  environments: EnvVarEnvironmentArray,
  content: Schema.optional(Schema.String.pipe(Schema.maxLength(4_000_000))),
  entries: Schema.optional(Schema.Array(BulkImportEntry).pipe(Schema.maxItems(100))),
  visibility: Schema.optional(EnvVarVisibility),
});

export const BulkImportResult = Schema.Struct({
  created: Schema.Number,
  updated: Schema.Number,
  skipped: Schema.Number,
});

export const DeleteEnvVarResult = Schema.Struct({
  id: Id,
});

export const EnvVarExportItem = Schema.Struct({
  key: Schema.String,
  value: Schema.String,
  visibility: EnvVarVisibility,
});

export const EnvVarExportResult = Schema.Struct({
  items: Schema.Array(EnvVarExportItem),
  environment: EnvVarEnvironment,
});
