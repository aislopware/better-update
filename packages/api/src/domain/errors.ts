import { HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

export class BadRequest extends Schema.TaggedError<BadRequest>()(
  "BadRequest",
  { message: Schema.String },
  HttpApiSchema.annotations({ status: 400 }),
) {}

export class Conflict extends Schema.TaggedError<Conflict>()(
  "Conflict",
  { message: Schema.String },
  HttpApiSchema.annotations({ status: 409 }),
) {}

export class NotAcceptable extends Schema.TaggedError<NotAcceptable>()(
  "NotAcceptable",
  { message: Schema.String },
  HttpApiSchema.annotations({ status: 406 }),
) {}
