import { Schema } from "effect";

export const Id = Schema.String.annotations({
  description: "UUIDv7 identifier",
});

export const DateTimeString = Schema.String.annotations({
  description: "ISO 8601 datetime",
});

export const Platform = Schema.Literal("ios", "android");

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

export const UpdateRolloutBody = Schema.Struct({
  percentage: Schema.Number.pipe(Schema.int(), Schema.between(1, 100)),
});

export const UploadHeaders = Schema.Record({ key: Schema.String, value: Schema.String });
