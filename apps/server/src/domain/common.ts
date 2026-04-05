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
