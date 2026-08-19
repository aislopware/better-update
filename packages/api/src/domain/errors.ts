import { Schema } from "effect";

export class BadRequest extends Schema.TaggedError<BadRequest>()(
  "BadRequest",
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}

export class Conflict extends Schema.TaggedError<Conflict>()(
  "Conflict",
  { message: Schema.String },
  { httpApiStatus: 409 },
) {}

export class NotAcceptable extends Schema.TaggedError<NotAcceptable>()(
  "NotAcceptable",
  { message: Schema.String },
  { httpApiStatus: 406 },
) {}
