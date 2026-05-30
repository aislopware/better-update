import { Effect } from "effect";

import { exitWith } from "../application/command-exit";
import { formatCause } from "./format-error";

import type { CliRuntime } from "../services/cli-runtime";
import type { OutputMode } from "./output-mode";

type ExitCode = 1 | 2 | 3 | 4 | 5 | 6 | 7;

interface TaggedError {
  readonly message: string;
  readonly hint?: unknown;
}

type Handler = (error: TaggedError) => Effect.Effect<void, never, CliRuntime | OutputMode>;

const BASE_TAG_MAP: Record<string, ExitCode> = {
  AuthRequiredError: 3,
  LoginError: 3,
  ProjectNotLinkedError: 4,
  NotFound: 1,
  Conflict: 1,
  Forbidden: 1,
  BadRequest: 2,
  InvalidArgumentError: 2,
  InteractiveProhibitedError: 2,
  IdentityError: 2,
};

const SYSTEM_TAG_MESSAGE: Record<string, (error: TaggedError) => string> = {
  SystemError: (error) => `Filesystem error: ${error.message}`,
  BadArgument: (error) => `Invalid argument: ${error.message}`,
};

const SYSTEM_TAG_CODE: Record<string, ExitCode> = {
  SystemError: 6,
  BadArgument: 6,
};

const errorHint = (error: TaggedError): string | undefined =>
  typeof error.hint === "string" ? error.hint : undefined;

export const makeCommandErrorHandler = (
  extras: Record<string, ExitCode> = {},
): (<Success, Requirements>(
  effect: Effect.Effect<Success, unknown, Requirements>,
) => Effect.Effect<Success, never, Requirements | CliRuntime | OutputMode>) => {
  const combined = { ...BASE_TAG_MAP, ...extras };
  const handlers: Record<string, Handler> = {};
  for (const [tag, code] of Object.entries(combined)) {
    const systemFormat = SYSTEM_TAG_MESSAGE[tag];
    const resolvedCode = SYSTEM_TAG_CODE[tag] ?? code;
    handlers[tag] = (error) =>
      exitWith(resolvedCode, {
        tag,
        message: systemFormat ? systemFormat(error) : error.message,
        hint: errorHint(error),
      });
  }

  return <Success, Requirements>(
    effect: Effect.Effect<Success, unknown, Requirements>,
  ): Effect.Effect<Success, never, Requirements | CliRuntime | OutputMode> => {
    const piped = effect.pipe(
      // eslint-disable-next-line typescript/no-unsafe-type-assertion -- Effect.catchTags tag-inference requires a literal object; we accept a dynamic handler map so tags are chosen at runtime
      Effect.catchTags(handlers as never),
      Effect.catchAll((cause) => exitWith(1, { tag: "Unknown", message: formatCause(cause) })),
    );
    // eslint-disable-next-line typescript/no-unsafe-type-assertion -- catchTags narrowing lost when handlers is dynamic; re-narrow at the boundary
    return piped as Effect.Effect<Success, never, Requirements | CliRuntime | OutputMode>;
  };
};
