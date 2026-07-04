import { Effect } from "effect";

import type { FileSystem } from "@effect/platform";

import { readBuildProfile } from "./build-profile";
import { readEasJson } from "./eas-config";

import type { BuildProfile } from "./build-profile";
import type { EasConfig } from "./eas-config";
import type { DecryptedEnvVar } from "./env-exporter";
import type { BuildProfileError } from "./exit-codes";

/**
 * EAS only wires the eas.json `env` block into native builds; `eas update` and
 * dev tooling ignore it, which forces per-app config (bundle ids, endpoints)
 * onto the server env store one key at a time. These helpers let every
 * env-consuming command opt into the SAME merge the build workflow runs —
 * `{...server, ...profile.env}`, profile wins on collision — via an optional
 * `--profile` flag.
 */

/** Resolve an optional `--profile` flag to its eas.json build profile (absent flag → undefined). */
export const readOptionalProfile = (
  projectRoot: string,
  profileName: string | undefined,
): Effect.Effect<BuildProfile | undefined, BuildProfileError, FileSystem.FileSystem> =>
  profileName === undefined
    ? Effect.succeed(undefined)
    : readBuildProfile(projectRoot, profileName);

/** Env scope precedence: explicit --environment, then the profile's `environment`, then production. */
export const resolveEnvironmentScope = (
  explicit: string | undefined,
  profile: BuildProfile | undefined,
): string => explicit ?? profile?.environment ?? "production";

/** Overlay the profile's env block on the decrypted server map (profile wins) — the build workflow's merge. */
export const overlayProfileEnv = (
  remote: Record<string, string>,
  profile: BuildProfile | undefined,
): Record<string, string> => ({ ...remote, ...profile?.env });

/**
 * Item-shaped overlay for `env pull`/`env export`: server entries the profile
 * overrides are replaced, profile-only keys are appended, and the combined set
 * is re-sorted so the key-order invariant of `exportDecryptedEnvVars` holds.
 * eas.json values are plaintext in git, so they carry `plaintext` visibility.
 */
export const overlayProfileEnvItems = (
  items: readonly DecryptedEnvVar[],
  profile: BuildProfile | undefined,
): readonly DecryptedEnvVar[] => {
  const env = profile?.env;
  if (env === undefined) {
    return items;
  }
  const overridden = new Set(Object.keys(env));
  return [
    ...items.filter((item) => !overridden.has(item.key)),
    ...Object.entries(env).map(([key, value]) => ({
      key,
      value,
      visibility: "plaintext" as const,
    })),
  ].toSorted((left, right) => left.key.localeCompare(right.key));
};

/**
 * Union of env keys across every eas.json build profile — the set `env push`
 * skips by default so eas.json config can't round-trip into the server store
 * (`env pull --profile` writes overlay values into the dotenv it pushes back).
 * Raw profiles suffice: `extends` only inherits from profiles already in the
 * file, so the union over raw blocks equals the union over resolved ones.
 */
export const collectProfileEnvKeys = (config: EasConfig): ReadonlySet<string> =>
  new Set(Object.values(config.build ?? {}).flatMap((profile) => Object.keys(profile.env ?? {})));

/** Best-effort read of that union: a missing or malformed eas.json yields the empty set, so commands that never needed eas.json keep working. */
export const readProfileEnvKeys = (
  projectRoot: string,
): Effect.Effect<ReadonlySet<string>, never, FileSystem.FileSystem> =>
  readEasJson(projectRoot).pipe(
    Effect.map(collectProfileEnvKeys),
    Effect.orElseSucceed((): ReadonlySet<string> => new Set()),
  );
