import { Effect } from "effect";

import type { Session } from "@expo/apple-utils";

import { CliRuntime } from "../services/cli-runtime";
import { AppleAuthError, InteractiveProhibitedError } from "./exit-codes";
import { InteractiveMode } from "./interactive-mode";
import { promptSelect } from "./prompts";

type SessionProvider = Session.SessionProvider;

/**
 * Minimal apple-utils surface needed by {@link resolveProvider}. Defined as a
 * structural subset so the helper stays decoupled from the full `typeof AppleUtils`
 * shape (which would force callers to import the whole module).
 */
export interface ProviderSwitcher {
  readonly Session: {
    readonly setSessionProviderIdAsync: (id: number) => Promise<unknown>;
  };
}

interface ProviderResolution {
  readonly providerId: number | undefined;
  readonly switched: boolean;
}

const APPLE_PROVIDER_ID_ENV = "APPLE_PROVIDER_ID";

const readEnv = (name: string) =>
  Effect.gen(function* () {
    const runtime = yield* CliRuntime;
    return yield* runtime.getEnv(name);
  });

export const parseProviderId = (raw: string): Effect.Effect<number, AppleAuthError> => {
  const id = Number(raw);
  return Number.isInteger(id)
    ? Effect.succeed(id)
    : Effect.fail(
        new AppleAuthError({
          message: `${APPLE_PROVIDER_ID_ENV} must be a numeric provider ID, got "${raw}".`,
        }),
      );
};

const readEnvProviderId: Effect.Effect<number | undefined, AppleAuthError, CliRuntime> = Effect.gen(
  function* () {
    const raw = yield* readEnv(APPLE_PROVIDER_ID_ENV);
    if (!raw) {
      return undefined;
    }
    return yield* parseProviderId(raw);
  },
);

const switchSessionProvider = (
  appleUtils: ProviderSwitcher,
  providerId: number,
): Effect.Effect<void, AppleAuthError> =>
  Effect.tryPromise({
    try: async () => appleUtils.Session.setSessionProviderIdAsync(providerId),
    catch: (error) =>
      new AppleAuthError({
        message: `Failed to switch App Store Connect provider (${providerId}): ${String(error)}`,
      }),
  }).pipe(Effect.asVoid);

/**
 * Resolve App Store Connect provider for the current session.
 *
 * Selection order: APPLE_PROVIDER_ID env → single available provider →
 * interactive prompt (always, when multi-team + interactive) → fall back to
 * apple-utils' currentProviderId (non-interactive only).
 *
 * Multi-team users are always re-prompted in interactive mode so a wrong pick
 * from a previous run can be corrected — we do NOT cache the team choice.
 *
 * `switched` flags that the apple-utils cookie jar was mutated.
 *
 * Non-interactive (CI): env or single-team paths still work; multi-team falls
 * back to whatever apple-utils auto-resolved from cookies. Fails with
 * InteractiveProhibitedError when multi-team and no signal at all.
 */
export const resolveProvider = (
  appleUtils: ProviderSwitcher,
  availableProviders: readonly SessionProvider[],
  currentProviderId: number | undefined,
): Effect.Effect<
  ProviderResolution,
  AppleAuthError | InteractiveProhibitedError,
  CliRuntime | InteractiveMode
> =>
  Effect.gen(function* () {
    let switched = false;

    const applyChoice = (picked: number) =>
      Effect.gen(function* () {
        if (currentProviderId !== picked) {
          yield* switchSessionProvider(appleUtils, picked);
          switched = true;
        }
        return picked;
      });

    const envId = yield* readEnvProviderId;
    if (envId !== undefined) {
      const id = yield* applyChoice(envId);
      return { providerId: id, switched };
    }

    if (availableProviders.length === 0) {
      return { providerId: currentProviderId, switched };
    }
    const [firstProvider] = availableProviders;
    if (availableProviders.length === 1 && firstProvider) {
      const id = yield* applyChoice(firstProvider.providerId);
      return { providerId: id, switched };
    }

    // Multi-provider: always prompt in interactive so a wrong pick is recoverable.
    const mode = yield* InteractiveMode;
    if (!mode.allow) {
      if (currentProviderId !== undefined) {
        return { providerId: currentProviderId, switched };
      }
      return yield* new InteractiveProhibitedError({
        message:
          "Multiple App Store Connect providers are available but no APPLE_PROVIDER_ID is set; re-run interactively or set the env var.",
      });
    }

    const picked = yield* promptSelect<number>(
      "Select App Store Connect provider:",
      availableProviders.map((provider) => ({
        value: provider.providerId,
        label: `${provider.name} [${provider.subType}] (${provider.providerId})`,
      })),
    );

    const id = yield* applyChoice(picked);
    return { providerId: id, switched };
  });
