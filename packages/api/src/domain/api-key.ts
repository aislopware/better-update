import { Schema } from "effect";

import { DateTimeString, Id, Name120 } from "./common";

// An organization API key, as surfaced by the IAM-gated mint/list/revoke
// endpoints. The hashed `key` column is NEVER exposed — only `start` (the first
// few characters of the plaintext, incl. the prefix) for UI identification.
export class ApiKey extends Schema.Class<ApiKey>("ApiKey")({
  id: Id,
  name: Schema.NullOr(Schema.String),
  start: Schema.NullOr(Schema.String),
  prefix: Schema.NullOr(Schema.String),
  enabled: Schema.Boolean,
  createdAt: DateTimeString,
  expiresAt: Schema.NullOr(DateTimeString),
}) {}

// A freshly-minted key. Extends {@link ApiKey} with the plaintext `key`, which
// is returned ONCE at creation and never persisted in cleartext (only its
// SHA-256/base64url hash lives in the `apikey.key` column).
export class CreatedApiKey extends Schema.Class<CreatedApiKey>("CreatedApiKey")({
  id: Id,
  name: Schema.NullOr(Schema.String),
  start: Schema.NullOr(Schema.String),
  prefix: Schema.NullOr(Schema.String),
  enabled: Schema.Boolean,
  createdAt: DateTimeString,
  expiresAt: Schema.NullOr(DateTimeString),
  key: Schema.String,
}) {}

export const CreateApiKeyBody = Schema.Struct({
  name: Name120,
  // Optional lifetime in days. Omit for a non-expiring key. Day-granularity +
  // positive-int means the smallest accepted value is 1 day, which incidentally
  // meets better-auth's `minExpiresIn` (86 400s) floor — note the mint path
  // inserts the row directly and does NOT re-consult the plugin config, so the
  // floor here is a property of the schema, not an enforced plugin guard.
  expiresInDays: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
});

export const ApiKeyList = Schema.Struct({ items: Schema.Array(ApiKey) });
