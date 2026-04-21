import { Data } from "effect";

import { makeCommandErrorHandler } from "../../lib/command-errors";
import { resolveNamedResourceId as resolveNamedResourceIdBase } from "../../lib/resolve-named-resource";

export class UpdateCommandError extends Data.TaggedError("UpdateCommandError")<{
  readonly message: string;
}> {}

export const handleUpdateCommandErrors = makeCommandErrorHandler({
  UpdateCommandError: 2,
  BuildProfileError: 2,
  RuntimeVersionError: 2,
  UpdateRollbackError: 2,
  UpdatePromoteError: 2,
});

export const resolveNamedResourceId = (params: {
  readonly items: readonly { readonly id: string; readonly name: string }[];
  readonly kind: string;
  readonly name: string;
}) => resolveNamedResourceIdBase(params, (message) => new UpdateCommandError({ message }));
