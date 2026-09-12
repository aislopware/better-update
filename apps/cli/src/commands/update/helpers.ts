import { Data } from "effect";

import { resolveNamedResourceId as resolveNamedResourceIdBase } from "../../lib/resolve-named-resource";

export class UpdateCommandError extends Data.TaggedError("UpdateCommandError")<{
  readonly message: string;
}> {}

export const resolveNamedResourceId = (params: {
  readonly items: readonly { readonly id: string; readonly name: string }[];
  readonly kind: string;
  readonly name: string;
}) => resolveNamedResourceIdBase(params, (message) => new UpdateCommandError({ message }));
