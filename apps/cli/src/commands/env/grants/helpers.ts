import { Data } from "effect";

export class EnvGrantCommandError extends Data.TaggedError("EnvGrantCommandError")<{
  readonly message: string;
}> {}

export const envGrantErrorExtras = { EnvGrantCommandError: 2 } as const;

/** Sentinel project token for the org-global env-var scope (mirrors server). */
export const ENV_GRANT_GLOBAL = "global" as const;

export const ENVIRONMENTS = ["development", "preview", "production"] as const;

export type EnvironmentName = (typeof ENVIRONMENTS)[number];

/**
 * Type guard narrowing a raw arg to an {@link EnvironmentName}. Lets set/unset
 * validate `args.environment` AND narrow it without an unsafe `as` assertion.
 */
export const isEnvironmentName = (value: string): value is EnvironmentName =>
  (ENVIRONMENTS as readonly string[]).includes(value);
