import {
  BadRequest as ApiBadRequest,
  Conflict as ApiConflict,
  Forbidden as ApiForbidden,
  NotFound as ApiNotFound,
} from "@better-update/api";
import { Effect, Match } from "effect";

import type { BadRequest, Conflict, Forbidden, NotFound } from "../errors";
import type { MissingValueError } from "../lib/require-value";

const mapForbiddenError = (error: Forbidden): ApiForbidden =>
  new ApiForbidden({ message: error.message });

const mapCrudError = Match.type<Conflict | Forbidden | NotFound>().pipe(
  Match.tag("Conflict", (error) => new ApiConflict({ message: error.message })),
  Match.tag("Forbidden", (error) => new ApiForbidden({ message: error.message })),
  Match.tag("NotFound", (error) => new ApiNotFound({ message: error.message })),
  Match.exhaustive,
);

const mapReadError = Match.type<Forbidden | NotFound>().pipe(
  Match.tag("Forbidden", (error) => new ApiForbidden({ message: error.message })),
  Match.tag("NotFound", (error) => new ApiNotFound({ message: error.message })),
  Match.exhaustive,
);

const mapWriteError = Match.type<
  BadRequest | Conflict | Forbidden | MissingValueError | NotFound
>().pipe(
  Match.tag("BadRequest", (error) => new ApiBadRequest({ message: error.message })),
  Match.tag("Conflict", (error) => new ApiConflict({ message: error.message })),
  Match.tag("Forbidden", (error) => new ApiForbidden({ message: error.message })),
  Match.tag(
    "MissingValueError",
    (error) => new ApiBadRequest({ message: `Missing required field: ${error.field}` }),
  ),
  Match.tag("NotFound", (error) => new ApiNotFound({ message: error.message })),
  Match.exhaustive,
);

const mapBadRequestReadError = Match.type<
  BadRequest | Forbidden | MissingValueError | NotFound
>().pipe(
  Match.tag("BadRequest", (error) => new ApiBadRequest({ message: error.message })),
  Match.tag("Forbidden", (error) => new ApiForbidden({ message: error.message })),
  Match.tag(
    "MissingValueError",
    (error) => new ApiBadRequest({ message: `Missing required field: ${error.field}` }),
  ),
  Match.tag("NotFound", (error) => new ApiNotFound({ message: error.message })),
  Match.exhaustive,
);

export const toApiForbiddenEffect = <Success, Requirements>(
  effect: Effect.Effect<Success, Forbidden, Requirements>,
) => Effect.mapError(effect, mapForbiddenError);

export const toApiCrudEffect = <Success, Requirements>(
  effect: Effect.Effect<Success, Conflict | Forbidden | NotFound, Requirements>,
) => Effect.mapError(effect, mapCrudError);

export const toApiReadEffect = <Success, Requirements>(
  effect: Effect.Effect<Success, Forbidden | NotFound, Requirements>,
) => Effect.mapError(effect, mapReadError);

export const toApiWriteEffect = <Success, Requirements>(
  effect: Effect.Effect<
    Success,
    BadRequest | Conflict | Forbidden | MissingValueError | NotFound,
    Requirements
  >,
) => Effect.mapError(effect, mapWriteError);

export const toApiBadRequestReadEffect = <Success, Requirements>(
  effect: Effect.Effect<
    Success,
    BadRequest | Forbidden | MissingValueError | NotFound,
    Requirements
  >,
) => Effect.mapError(effect, mapBadRequestReadError);

// A read path that can also Conflict — e.g. the vault-rotation-pending block on
// credential downloads (build-credentials.resolve, env-vars.export). Same error
// set as a write, surfaced from a read handler; reuses the write matcher.
export const toApiResolveReadEffect = <Success, Requirements>(
  effect: Effect.Effect<
    Success,
    BadRequest | Conflict | Forbidden | MissingValueError | NotFound,
    Requirements
  >,
) => Effect.mapError(effect, mapWriteError);
