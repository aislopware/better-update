import { HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

export class NotFound extends Schema.TaggedError<NotFound>()(
  "NotFound",
  { message: Schema.String },
  HttpApiSchema.annotations({ status: 404 }),
) {}
