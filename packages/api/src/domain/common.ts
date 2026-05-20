import { HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

export const Id = Schema.String.annotations({
  description: "UUIDv7 identifier",
});

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
