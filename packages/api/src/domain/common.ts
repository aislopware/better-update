import { HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

export const Id = Schema.String.annotations({
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
export const UuidLower = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u, {
    message: () => "embedded update id must be a lowercase UUID",
  }),
);

/** Shared `:id` path parameter for resource endpoints. */
export const idParam = HttpApiSchema.param("id", Schema.String);

/** Standard "rows affected" response for delete endpoints. */
export const DeletedResult = Schema.Struct({ deleted: Schema.Number });

export const DateTimeString = Schema.String.annotations({
  description: "ISO 8601 datetime",
});

export const Platform = Schema.Literal("ios", "android");

/** Non-empty, user-facing resource name capped at 120 chars. */
export const Name120 = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(120));

export const PaginationParams = Schema.Struct({
  page: Schema.optional(Schema.NumberFromString),
  limit: Schema.optional(Schema.NumberFromString),
});

export const CursorPaginationParams = Schema.Struct({
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
});

export const cursorPageResult = <T, Encoded, R>(itemSchema: Schema.Schema<T, Encoded, R>) =>
  Schema.Struct({
    items: Schema.Array(itemSchema),
    nextCursor: Schema.NullOr(Schema.String),
  });

export const pageResult = <T, Encoded, R>(itemSchema: Schema.Schema<T, Encoded, R>) =>
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
export const sortParam = <Column extends Schema.Schema.AnyNoContext>(column: Column) =>
  Schema.Union(column, Schema.TemplateLiteral("-", column));

export const UpdateRolloutBody = Schema.Struct({
  percentage: Schema.Number.pipe(Schema.int(), Schema.between(1, 100)),
});

export const UploadHeaders = Schema.Record({ key: Schema.String, value: Schema.String });
