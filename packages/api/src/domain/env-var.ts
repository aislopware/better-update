import { Schema } from "effect";

import { DateTimeString, Id } from "./common";
import { encryptedEnvelopeFields } from "./encrypted-credential";
import { EnvironmentName } from "./environment";
import { VaultVersion } from "./org-vault";

export const EnvVarVisibility = Schema.Literal("plaintext", "sensitive");

export const EnvVarScope = Schema.Literal("project", "global");

// An env var's environment is any of the org's environments (built-in or
// user-defined), so this is a free-form environment name rather than a fixed
// enum — the server validates it against the org's environments at write time.
export const EnvVarEnvironment = EnvironmentName;

export const EnvVarListScope = Schema.Literal("all", "project", "global");

/**
 * A client-sealed env var value. `id` is the revision UUID the CLI bound as the
 * AAD `credentialId` when sealing; the envelope fields are the opaque ciphertext,
 * wrapped DEK, and vault version. The server stores these and never decrypts —
 * env var values are end-to-end encrypted, like credentials.
 *
 * `vaultKind` names which vault the DEK was sealed under. It is OPTIONAL for
 * back-compat: a pre-split CLI omits it (the server treats absence as
 * `"credentials"`). Once an org cuts over to a separate env vault, the server
 * requires `"env"` here — without it a credentials-keyed blob from an un-upgraded
 * (or racing) CLI would otherwise be silently stored into an env-vault row and be
 * permanently undecryptable. See `assertEnvVaultWriteAllowed`.
 */
export const EnvVarValueEnvelope = Schema.Struct({
  id: Id,
  ...encryptedEnvelopeFields,
  vaultKind: Schema.optional(Schema.Literal("credentials", "env")),
});

// Human-readable documentation for a variable (non-secret). A short label and a
// longer description that explain what the variable is for, so non-technical
// people can update its value in the portal with confidence. Shared per
// (scope, key) — the same across every environment — not per revision.
export const EnvVarLabel = Schema.String.pipe(Schema.maxLength(120));
export const EnvVarDescriptionText = Schema.String.pipe(Schema.maxLength(500));

/**
 * Env var metadata. The value is **not** here — it lives encrypted in the
 * revision pointed at by `currentRevisionId` and is only ever readable by the
 * CLI (which holds the org vault key). One entity per (scope, key, environment).
 *
 * `label`/`description` are non-secret documentation shared across a variable's
 * environments (keyed by scope + key); they are `null` when unset. Optional on
 * the wire for back-compat: an older server omits them entirely.
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
  label: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
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
  // Optional non-secret documentation set on the same call. Applies to the
  // variable (scope + key), so it is shared across every environment.
  label: Schema.optional(EnvVarLabel),
  description: Schema.optional(EnvVarDescriptionText),
});

/**
 * Upsert a variable's non-secret documentation, keyed by (scope, key) — shared
 * across every environment. `label`/`description` are three-state: omit to leave
 * unchanged, send `null` to clear, or a string to set. This is NOT a secret write:
 * it needs no vault and no WebAuthn step-up, only the `envVar:update` permission.
 */
export const UpsertEnvVarDescriptionBody = Schema.Struct({
  scope: EnvVarScope,
  projectId: Schema.optional(Id),
  key: EnvVarKey,
  label: Schema.optional(Schema.NullOr(EnvVarLabel)),
  description: Schema.optional(Schema.NullOr(EnvVarDescriptionText)),
});

/** The saved documentation for a variable (scope + key). */
export const EnvVarDescription = Schema.Struct({
  scope: EnvVarScope,
  projectId: Schema.NullOr(Id),
  key: Schema.String,
  label: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
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

// A project var shadows a global var only for the same key AND environment.
const overrideKey = (item: EnvVar) => `${item.environment}\t${item.key}`;

/**
 * Re-run project-over-global override resolution across an ACCUMULATED list.
 * The list endpoint resolves overrides per page, so a client that concatenates
 * pages (`hasMore` loop) can end up holding a global row whose project
 * counterpart landed on a different page — drop it and flag the project row.
 * A no-op for single-scope lists.
 */
export const resolveEnvVarOverrides = (items: readonly EnvVar[]): readonly EnvVar[] => {
  const projectPairs = new Set(items.filter((item) => item.scope === "project").map(overrideKey));
  const globalPairs = new Set(items.filter((item) => item.scope === "global").map(overrideKey));
  return items
    .filter((item) => !(item.scope === "global" && projectPairs.has(overrideKey(item))))
    .map((item) =>
      item.scope === "project" && !item.overridesGlobal && globalPairs.has(overrideKey(item))
        ? // eslint-disable-next-line typescript/no-misused-spread -- the spread feeds the class constructor, which rebuilds the EnvVar prototype
          new EnvVar({ ...item, overridesGlobal: true })
        : item,
    );
};
