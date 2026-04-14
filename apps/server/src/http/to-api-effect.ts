import {
  BadRequest as ApiBadRequest,
  Conflict as ApiConflict,
  Forbidden as ApiForbidden,
  NotFound as ApiNotFound,
} from "@better-update/api";
import { Effect } from "effect";

import type { BadRequest, Conflict, Forbidden, NotFound } from "../errors";

const exhaust = (value: never): never => value;

const mapForbiddenError = (error: Forbidden): ApiForbidden =>
  new ApiForbidden({ message: error.message });

const mapReadError = (error: Forbidden | NotFound): ApiForbidden | ApiNotFound =>
  error._tag === "Forbidden"
    ? new ApiForbidden({ message: error.message })
    : new ApiNotFound({ message: error.message });

const mapCrudError = (
  error: Conflict | Forbidden | NotFound,
): ApiConflict | ApiForbidden | ApiNotFound => {
  switch (error._tag) {
    case "Conflict": {
      return new ApiConflict({ message: error.message });
    }
    case "Forbidden": {
      return new ApiForbidden({ message: error.message });
    }
    case "NotFound": {
      return new ApiNotFound({ message: error.message });
    }
    default: {
      return exhaust(error);
    }
  }
};

const mapWriteError = (
  error: BadRequest | Conflict | Forbidden | NotFound,
): ApiBadRequest | ApiConflict | ApiForbidden | ApiNotFound => {
  switch (error._tag) {
    case "BadRequest": {
      return new ApiBadRequest({ message: error.message });
    }
    case "Conflict": {
      return new ApiConflict({ message: error.message });
    }
    case "Forbidden": {
      return new ApiForbidden({ message: error.message });
    }
    case "NotFound": {
      return new ApiNotFound({ message: error.message });
    }
    default: {
      return exhaust(error);
    }
  }
};

const mapBadRequestReadError = (
  error: BadRequest | Forbidden | NotFound,
): ApiBadRequest | ApiForbidden | ApiNotFound => {
  switch (error._tag) {
    case "BadRequest": {
      return new ApiBadRequest({ message: error.message });
    }
    case "Forbidden": {
      return new ApiForbidden({ message: error.message });
    }
    case "NotFound": {
      return new ApiNotFound({ message: error.message });
    }
    default: {
      return exhaust(error);
    }
  }
};

export const toApiForbiddenEffect = <Success, Requirements>(
  effect: Effect.Effect<Success, Forbidden, Requirements>,
) => Effect.mapError(effect, mapForbiddenError);

export const toApiReadEffect = <Success, Requirements>(
  effect: Effect.Effect<Success, Forbidden | NotFound, Requirements>,
) => Effect.mapError(effect, mapReadError);

export const toApiCrudEffect = <Success, Requirements>(
  effect: Effect.Effect<Success, Conflict | Forbidden | NotFound, Requirements>,
) => Effect.mapError(effect, mapCrudError);

export const toApiWriteEffect = <Success, Requirements>(
  effect: Effect.Effect<Success, BadRequest | Conflict | Forbidden | NotFound, Requirements>,
) => Effect.mapError(effect, mapWriteError);

export const toApiBadRequestReadEffect = <Success, Requirements>(
  effect: Effect.Effect<Success, BadRequest | Forbidden | NotFound, Requirements>,
) => Effect.mapError(effect, mapBadRequestReadError);
