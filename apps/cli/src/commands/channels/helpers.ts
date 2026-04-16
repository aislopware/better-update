import { Conflict, Forbidden, NotFound } from "@better-update/api";
import { Data, Effect } from "effect";

import { exitWith } from "../../application/command-exit";
import { AuthRequiredError, ProjectNotLinkedError } from "../../lib/exit-codes";
import { formatCause } from "../../lib/format-error";

export class ChannelCommandError extends Data.TaggedError("ChannelCommandError")<{
  readonly message: string;
}> {}

export const handleChannelCommandErrors = <A, R>(effect: Effect.Effect<A, unknown, R>) =>
  effect.pipe(
    Effect.catchTags({
      AuthRequiredError: (error: AuthRequiredError) => exitWith(3, error.message),
      ProjectNotLinkedError: (error: ProjectNotLinkedError) => exitWith(4, error.message),
      ChannelCommandError: (error: ChannelCommandError) => exitWith(2, error.message),
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
}): Effect.Effect<string, ChannelCommandError> =>
  Effect.gen(function* () {
    const match = params.items.find((item) => item.name === params.name);
    if (match === undefined) {
      return yield* new ChannelCommandError({
        message: `${params.kind} "${params.name}" not found in the linked project.`,
      });
    }
    return match.id;
  });
