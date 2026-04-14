import { Schema } from "effect";

export class BadRequest extends Schema.TaggedError<BadRequest>()("BadRequest", {
  message: Schema.String,
}) {}

export class Conflict extends Schema.TaggedError<Conflict>()("Conflict", {
  message: Schema.String,
}) {}

export class NotAcceptable extends Schema.TaggedError<NotAcceptable>()("NotAcceptable", {
  message: Schema.String,
}) {}

export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  message: Schema.String,
}) {}
