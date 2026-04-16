import { Conflict, Forbidden, NotFound } from "@better-update/api";
import { Data, Effect } from "effect";

import { exitWith } from "../../application/command-exit";
import { AuthRequiredError, ProjectNotLinkedError } from "../../lib/exit-codes";

export class BranchCommandError extends Data.TaggedError("BranchCommandError")<{
  readonly message: string;
}> {}

const formatCause = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message;
  }

  if (typeof cause === "object" && cause !== null) {
    const tagged = cause as { readonly _tag?: unknown; readonly message?: unknown };
    const message = typeof tagged.message === "string" ? tagged.message : undefined;
    const tag = typeof tagged._tag === "string" ? tagged._tag : undefined;
    if (message) {
      return message;
    }
    if (tag) {
      return tag;
    }
  }

  return String(cause);
};

export const handleBranchCommandErrors = <A, R>(effect: Effect.Effect<A, unknown, R>) =>
  effect.pipe(
    Effect.catchTags({
      AuthRequiredError: (error: AuthRequiredError) => exitWith(3, error.message),
      ProjectNotLinkedError: (error: ProjectNotLinkedError) => exitWith(4, error.message),
      BranchCommandError: (error: BranchCommandError) => exitWith(2, error.message),
      NotFound: (error: NotFound) => exitWith(1, error.message),
      Conflict: (error: Conflict) => exitWith(1, error.message),
      Forbidden: (error: Forbidden) => exitWith(1, error.message),
    }),
    Effect.catchAll((cause) => exitWith(1, formatCause(cause))),
  );
