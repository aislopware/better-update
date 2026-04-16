import { Forbidden } from "@better-update/api";
import { Effect } from "effect";

import { exitWith } from "../../application/command-exit";
import { AuthRequiredError } from "../../lib/exit-codes";
import { formatCause } from "../../lib/format-error";

export const handleAuditLogCommandErrors = <A, R>(effect: Effect.Effect<A, unknown, R>) =>
  effect.pipe(
    Effect.catchTags({
      AuthRequiredError: (error: AuthRequiredError) => exitWith(3, error.message),
      Forbidden: (error: Forbidden) => exitWith(1, error.message),
    }),
    Effect.catchAll((cause) => exitWith(1, formatCause(cause))),
  );
