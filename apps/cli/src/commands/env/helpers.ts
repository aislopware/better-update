import { Data } from "effect";

export class EnvResourceNotFoundError extends Data.TaggedError("EnvResourceNotFoundError")<{
  readonly message: string;
}> {}

export const envErrorExtras = {
  EnvResourceNotFoundError: 1,
  SystemError: 6,
  BadArgument: 6,
} as const;
