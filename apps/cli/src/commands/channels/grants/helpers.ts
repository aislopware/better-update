import { Data } from "effect";

export class GrantCommandError extends Data.TaggedError("GrantCommandError")<{
  readonly message: string;
}> {}

export const grantErrorExtras = { GrantCommandError: 2 } as const;
