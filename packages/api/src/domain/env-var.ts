import { Schema } from "effect";

import { DateTimeString, Id } from "./common";

export const EnvVarVisibility = Schema.Literal("plaintext", "sensitive", "secret");

export class EnvVar extends Schema.Class<EnvVar>("EnvVar")({
  id: Id,
  organizationId: Id,
  projectId: Id,
  environment: Schema.String,
  key: Schema.String,
  visibility: EnvVarVisibility,
  value: Schema.NullOr(Schema.String),
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}) {}

// Key validation: uppercase letters, digits, underscores. Must start with letter.
const EnvVarKey = Schema.String.pipe(Schema.pattern(/^[A-Z][A-Z0-9_]*$/), Schema.maxLength(256));

const EnvVarValue = Schema.String.pipe(Schema.maxLength(32_768));

const EnvVarEnvironment = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(64));

export const CreateEnvVarBody = Schema.Struct({
  projectId: Id,
  environment: EnvVarEnvironment,
  key: EnvVarKey,
  value: EnvVarValue,
  visibility: EnvVarVisibility,
});

export const UpdateEnvVarBody = Schema.Struct({
  value: Schema.optional(EnvVarValue),
  visibility: Schema.optional(EnvVarVisibility),
});

export const BulkImportEnvVarsBody = Schema.Struct({
  projectId: Id,
  environment: EnvVarEnvironment,
  content: Schema.String,
  visibility: EnvVarVisibility,
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
  environment: Schema.String,
});
