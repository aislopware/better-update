import { Data } from "effect";

import { resolveNamedResourceId as resolveNamedResourceIdBase } from "../../lib/resolve-named-resource";

export class ChannelCommandError extends Data.TaggedError("ChannelCommandError")<{
  readonly message: string;
}> {}

export const channelErrorExtras = { ChannelCommandError: 2 } as const;

export const resolveNamedResourceId = (params: {
  readonly items: readonly { readonly id: string; readonly name: string }[];
  readonly kind: string;
  readonly name: string;
}) => resolveNamedResourceIdBase(params, (message) => new ChannelCommandError({ message }));
