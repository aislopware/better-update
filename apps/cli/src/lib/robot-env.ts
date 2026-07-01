import { fromBase64Url, toBase64Url } from "@better-update/encoding";
import { Effect } from "effect";

import { IdentityError } from "./exit-codes";

/**
 * The `BETTER_UPDATE_ROBOT` CI env var: one bundled credential carrying both
 * halves of a robot account — the bearer secret (HTTP/API auth) and the age
 * private key (vault decrypt) — so a CI pipeline sets exactly one secret
 * instead of pairing two. Either half may be absent (e.g. a robot backfilled
 * from a pre-existing machine key has no bearer until `credentials robot
 * rotate` is run).
 */
export interface RobotEnv {
  readonly bearer: string | null;
  readonly identity: string | null;
}

const ROBOT_ENV_VERSION = 1;

export const serializeRobotEnv = (env: RobotEnv): string => {
  const json = JSON.stringify({ version: ROBOT_ENV_VERSION, ...env });
  return toBase64Url(new TextEncoder().encode(json));
};

interface RobotEnvShape {
  readonly version: number;
  readonly bearer: unknown;
  readonly identity: unknown;
}

const isRobotEnvShape = (value: unknown): value is RobotEnvShape =>
  typeof value === "object" &&
  value !== null &&
  "version" in value &&
  "bearer" in value &&
  "identity" in value;

const INVALID_ROBOT_ENV = new IdentityError({
  message: "BETTER_UPDATE_ROBOT is not a valid robot account credential.",
});

export const parseRobotEnv = (raw: string): Effect.Effect<RobotEnv, IdentityError> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: (): unknown => JSON.parse(new TextDecoder().decode(fromBase64Url(raw))),
      catch: () => INVALID_ROBOT_ENV,
    });
    if (!isRobotEnvShape(parsed) || parsed.version !== ROBOT_ENV_VERSION) {
      return yield* INVALID_ROBOT_ENV;
    }
    return {
      bearer: typeof parsed.bearer === "string" ? parsed.bearer : null,
      identity: typeof parsed.identity === "string" ? parsed.identity : null,
    };
  });
