import { Schema, SchemaGetter } from "effect";

export const Id = Schema.String.annotate({
  description: "UUIDv7 identifier",
});

/**
 * A strict lowercase UUID (8-4-4-4-12 hex), mirroring the `IssuerId` UUID
 * pattern. Lowercase-only is deliberate: an embedded baseline's id MUST equal
 * the `expo-embedded-update-id` the device reports, which both
 * `FileDownloader.swift`/`.kt` send `.lowercased()` and `selectPatchCandidates`
 * lowercases before building the patch R2 key — so the stored id must already be
 * lowercase for the patch key to match. Distinct from `Id` (which stays
 * permissive for server-minted ids of every shape) to avoid collateral contract
 * changes.
 */
export const UuidLower = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u, {
    message: "embedded update id must be a lowercase UUID",
  }),
);

/** Shared `:id` path parameter for resource endpoints. */
export const idParam = { id: Schema.String };

/** Standard "rows affected" response for delete endpoints. */
export const DeletedResult = Schema.Struct({ deleted: Schema.Number });

export const DateTimeString = Schema.String.annotate({
  description: "ISO 8601 datetime",
});

export const Platform = Schema.Literals(["ios", "android"]);

/** Non-empty, user-facing resource name capped at 120 chars. */
export const Name120 = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120));

/**
 * Comma-separated multi-value filter param (e.g. `?platform=ios,android`).
 * Decodes the CSV wire string into a validated array of `item`; a single bare
 * value stays wire-compatible with the scalar params these filters replaced.
 */
export const csvList = <Value extends string>(item: Schema.Codec<Value, string>) =>
  Schema.String.pipe(
    Schema.decodeTo(Schema.Array(item), {
      // The split is unvalidated on purpose: `Schema.Array(item)` narrows each
      // element to `Value` right after this getter runs.
      decode: SchemaGetter.split(),
      encode: SchemaGetter.transform((values: readonly string[]) => values.join(",")),
    }),
  );

export const PaginationParams = Schema.Struct({
  page: Schema.optional(Schema.NumberFromString),
  limit: Schema.optional(Schema.NumberFromString),
});

export const CursorPaginationParams = Schema.Struct({
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
});

export const cursorPageResult = <T, Encoded>(itemSchema: Schema.Codec<T, Encoded>) =>
  Schema.Struct({
    items: Schema.Array(itemSchema),
    nextCursor: Schema.NullOr(Schema.String),
  });

export const pageResult = <T, Encoded>(itemSchema: Schema.Codec<T, Encoded>) =>
  Schema.Struct({
    items: Schema.Array(itemSchema),
    total: Schema.Number,
    page: Schema.Number,
    limit: Schema.Number,
  });

/**
 * Sort param: a column name optionally prefixed with `-` for descending.
 * Example: `name` (asc), `-lastActivityAt` (desc).
 */
// Built one member at a time rather than as `TemplateLiteral(["-", column])`
// over the whole `Literals`: v4's JSON-schema compiler can only turn `Literal`,
// `String`, `Number`, `TemplateLiteral` and `Union` parts into a pattern, and a
// `Literals` part makes the whole OpenAPI document fail to render.
export const sortParam = <const Columns extends readonly string[]>(
  column: Schema.Literals<Columns>,
) =>
  Schema.Union([
    ...column.members,
    ...column.members.map((member) => Schema.TemplateLiteral(["-", member])),
  ]);

export const UpdateRolloutBody = Schema.Struct({
  percentage: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 })),
});

export const UploadHeaders = Schema.Record(Schema.String, Schema.String);

/**
 * `"true"`/`"false"` query-string flag decoded to a boolean. v4 dropped
 * `Schema.BooleanFromString`, so the codec is spelled out here and shared.
 */
export const BooleanFromString = Schema.Literals(["true", "false"]).pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((value: "true" | "false") => value === "true"),
    encode: SchemaGetter.transform((value: boolean) =>
      value ? ("true" as const) : ("false" as const),
    ),
  }),
);
