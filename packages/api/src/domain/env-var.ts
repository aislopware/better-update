import { Schema } from "effect";

import { DateTimeString, Id } from "./common";
import { encryptedEnvelopeFields } from "./encrypted-credential";
import { VaultVersion } from "./org-vault";

export const EnvVarVisibility = Schema.Literal("plaintext", "sensitive");

export const EnvVarScope = Schema.Literal("project", "global");

export const EnvVarEnvironment = Schema.Literal("development", "preview", "production");

export const EnvVarListScope = Schema.Literal("all", "project", "global");

/**
 * A client-sealed env var value. `id` is the revision UUID the CLI bound as the
 * AAD `credentialId` when sealing; the envelope fields are the opaque ciphertext,
 * wrapped DEK, and vault version. The server stores these and never decrypts —
 * env var values are end-to-end encrypted, like credentials.
 */
export const EnvVarValueEnvelope = Schema.Struct({
  id: Id,
  ...encryptedEnvelopeFields,
});

/**
 * Env var metadata. The value is **not** here — it lives encrypted in the
 * revision pointed at by `currentRevisionId` and is only ever readable by the
 * CLI (which holds the org vault key). One entity per (scope, key, environment).
 */
export class EnvVar extends Schema.Class<EnvVar>("EnvVar")({
  id: Id,
  organizationId: Id,
  projectId: Schema.NullOr(Id),
  scope: EnvVarScope,
  environment: EnvVarEnvironment,
  key: Schema.String,
  visibility: EnvVarVisibility,
  currentRevisionId: Schema.NullOr(Id),
  revisionNumber: Schema.NullOr(Schema.Number),
  revisionCount: Schema.Number,
  overridesGlobal: Schema.optional(Schema.Boolean),
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}) {}

// Key validation: uppercase letters, digits, underscores. Must start with letter.
const EnvVarKey = Schema.String.pipe(Schema.pattern(/^[A-Z][A-Z0-9_]*$/u), Schema.maxLength(256));

export const CreateEnvVarBody = Schema.Struct({
  scope: EnvVarScope,
  projectId: Schema.optional(Id),
  environment: EnvVarEnvironment,
  key: EnvVarKey,
  visibility: EnvVarVisibility,
  value: EnvVarValueEnvelope,
});

export const UpdateEnvVarBody = Schema.Struct({
  // A new sealed revision (changes the value); omit to only change visibility.
  value: Schema.optional(EnvVarValueEnvelope),
  visibility: Schema.optional(EnvVarVisibility),
});

export const BulkImportEntry = Schema.Struct({
  key: EnvVarKey,
  environment: EnvVarEnvironment,
  visibility: EnvVarVisibility,
  value: EnvVarValueEnvelope,
});

/**
 * Bulk import already-sealed entries. The CLI parses the dotenv file, seals each
 * value per (key, environment) locally, and sends the envelopes — the server
 * cannot parse or encrypt plaintext itself.
 */
export const BulkImportEnvVarsBody = Schema.Struct({
  scope: EnvVarScope,
  projectId: Schema.optional(Id),
  entries: Schema.Array(BulkImportEntry).pipe(Schema.minItems(1), Schema.maxItems(300)),
});

export const BulkImportResult = Schema.Struct({
  created: Schema.Number,
  updated: Schema.Number,
  skipped: Schema.Number,
});

export const DeleteEnvVarResult = Schema.Struct({
  id: Id,
});

/** One exported variable's sealed value envelope; the CLI decrypts it locally. */
export const EnvVarExportItem = Schema.Struct({
  key: Schema.String,
  environment: EnvVarEnvironment,
  visibility: EnvVarVisibility,
  id: Id,
  ...encryptedEnvelopeFields,
});

export const EnvVarExportResult = Schema.Struct({
  items: Schema.Array(EnvVarExportItem),
  environment: EnvVarEnvironment,
});

/** One entry in a variable's value history (metadata only — no ciphertext). */
export const EnvVarRevision = Schema.Struct({
  id: Id,
  revisionNumber: Schema.Number,
  vaultVersion: VaultVersion,
  isCurrent: Schema.Boolean,
  createdBy: Schema.NullOr(Id),
  createdAt: DateTimeString,
});

export const EnvVarRevisionsResult = Schema.Struct({
  items: Schema.Array(EnvVarRevision),
});

export const RollbackEnvVarBody = Schema.Struct({
  toRevisionId: Id,
});
