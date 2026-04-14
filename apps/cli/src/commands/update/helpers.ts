import { BadRequest, Conflict, Forbidden, NotFound } from "@better-update/api";
import { Data, Effect } from "effect";

import { exitWith } from "../../application/command-exit";
import { AuthRequiredError, ProjectNotLinkedError } from "../../lib/exit-codes";

export class UpdateCommandError extends Data.TaggedError("UpdateCommandError")<{
  readonly message: string;
}> {}

export const formatCause = (cause: unknown): string => {
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

export const handleUpdateCommandErrors = <A, R>(effect: Effect.Effect<A, unknown, R>) =>
  effect.pipe(
    Effect.catchTags({
      AuthRequiredError: (error: AuthRequiredError) => exitWith(3, error.message),
      ProjectNotLinkedError: (error: ProjectNotLinkedError) => exitWith(4, error.message),
      UpdateCommandError: (error: UpdateCommandError) => exitWith(2, error.message),
      BadRequest: (error: BadRequest) => exitWith(2, error.message),
      NotFound: (error: NotFound) => exitWith(1, error.message),
      Conflict: (error: Conflict) => exitWith(1, error.message),
      Forbidden: (error: Forbidden) => exitWith(1, error.message),
    }),
    Effect.catchAll((cause) => exitWith(1, formatCause(cause))),
  );

interface NamedResource {
  readonly id: string;
  readonly name: string;
}

export const resolveNamedResourceId = <T extends NamedResource>(params: {
  readonly items: readonly T[];
  readonly kind: string;
  readonly name: string;
}): Effect.Effect<string, UpdateCommandError> =>
  Effect.gen(function* () {
    const match = params.items.find((item) => item.name === params.name);
    if (match === undefined) {
      return yield* new UpdateCommandError({
        message: `${params.kind} "${params.name}" not found in the linked project.`,
      });
    }
    return match.id;
  });
