import { Data } from "effect";

import { makeCommandErrorHandler } from "../../lib/command-errors";

export class EnvResourceNotFoundError extends Data.TaggedError("EnvResourceNotFoundError")<{
  readonly message: string;
}> {}

export const handleEnvCommandErrors = makeCommandErrorHandler({
  EnvResourceNotFoundError: 1,
  SystemError: 6,
  BadArgument: 6,
});
