import { Data } from "effect";

import { makeCommandErrorHandler } from "../../lib/command-errors";
import { resolveNamedResourceId as resolveNamedResourceIdBase } from "../../lib/resolve-named-resource";

export class ChannelCommandError extends Data.TaggedError("ChannelCommandError")<{
  readonly message: string;
}> {}

export const handleChannelCommandErrors = makeCommandErrorHandler({
  ChannelCommandError: 2,
});

export const resolveNamedResourceId = <
  T extends { readonly id: string; readonly name: string },
>(params: {
  readonly items: readonly T[];
  readonly kind: string;
  readonly name: string;
}) => resolveNamedResourceIdBase(params, (message) => new ChannelCommandError({ message }));
