import { Effect } from "effect";

import { exitWith } from "../application/command-exit";
import { CliRuntime } from "../services/cli-runtime";
import { formatCause } from "./format-error";

type ExitCode = 1 | 2 | 3 | 4 | 5 | 6;

type TaggedError = { readonly message: string };

type Handler = (error: TaggedError) => Effect.Effect<void, never, CliRuntime>;

const BASE_TAG_MAP: Record<string, ExitCode> = {
  AuthRequiredError: 3,
  ProjectNotLinkedError: 4,
  NotFound: 1,
  Conflict: 1,
  Forbidden: 1,
  BadRequest: 2,
};

const SYSTEM_TAG_MESSAGE: Record<string, (error: TaggedError) => string> = {
  SystemError: (error) => `Filesystem error: ${error.message}`,
  BadArgument: (error) => `Invalid argument: ${error.message}`,
};

const SYSTEM_TAG_CODE: Record<string, ExitCode> = {
  SystemError: 6,
  BadArgument: 6,
};

export const makeCommandErrorHandler = (
  extras: Record<string, ExitCode> = {},
): (<A, R>(effect: Effect.Effect<A, unknown, R>) => Effect.Effect<A, never, R | CliRuntime>) => {
  const combined = { ...BASE_TAG_MAP, ...extras };
  const handlers: Record<string, Handler> = {};
  for (const [tag, code] of Object.entries(combined)) {
    const systemFormat = SYSTEM_TAG_MESSAGE[tag];
    const resolvedCode = SYSTEM_TAG_CODE[tag] ?? code;
    handlers[tag] = (error) =>
      exitWith(resolvedCode, systemFormat ? systemFormat(error) : error.message);
  }

  return <A, R>(effect: Effect.Effect<A, unknown, R>): Effect.Effect<A, never, R | CliRuntime> =>
    effect.pipe(
      // Cast: Effect.catchTags' inference is tied to the exact tags it sees;
      // pass a dynamic record so we narrow once at the boundary.
      Effect.catchTags(handlers as never),
      Effect.catchAll((cause) => exitWith(1, formatCause(cause))),
    ) as Effect.Effect<A, never, R | CliRuntime>;
};
