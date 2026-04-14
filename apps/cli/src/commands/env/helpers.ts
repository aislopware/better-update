import { BadRequest, Conflict, Forbidden, NotFound } from "@better-update/api";
import { Data, Effect } from "effect";

import type { BadArgument, SystemError } from "@effect/platform/Error";

import { exitWith } from "../../application/command-exit";
import { AuthRequiredError, ProjectNotLinkedError } from "../../lib/exit-codes";

export class EnvCommandError extends Data.TaggedError("EnvCommandError")<{
  readonly message: string;
}> {}

export class EnvResourceNotFoundError extends Data.TaggedError("EnvResourceNotFoundError")<{
  readonly message: string;
}> {}

const formatCause = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message;
  }

  if (typeof cause === "object" && cause !== null) {
    const tagged = cause as { readonly _tag?: unknown; readonly message?: unknown };
    const tag = typeof tagged._tag === "string" ? tagged._tag : undefined;
    const message = typeof tagged.message === "string" ? tagged.message : undefined;
    if (message) {
      return message;
    }
    if (tag) {
      return tag;
    }
  }

  return String(cause);
};

export const handleEnvCommandErrors = <A, R>(effect: Effect.Effect<A, unknown, R>) =>
  effect.pipe(
    Effect.catchTags({
      AuthRequiredError: (error: AuthRequiredError) => exitWith(3, error.message),
      ProjectNotLinkedError: (error: ProjectNotLinkedError) => exitWith(4, error.message),
      EnvCommandError: (error: EnvCommandError) => exitWith(2, error.message),
      EnvResourceNotFoundError: (error: EnvResourceNotFoundError) => exitWith(1, error.message),
      BadRequest: (error: BadRequest) => exitWith(2, error.message),
      NotFound: (error: NotFound) => exitWith(1, error.message),
      Conflict: (error: Conflict) => exitWith(1, error.message),
      Forbidden: (error: Forbidden) => exitWith(1, error.message),
      SystemError: (error: SystemError) => exitWith(6, `Filesystem error: ${error.message}`),
      BadArgument: (error: BadArgument) => exitWith(6, `Invalid argument: ${error.message}`),
    }),
    Effect.catchAll((cause) => exitWith(1, formatCause(cause))),
  );
