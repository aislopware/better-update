import { Effect } from "effect";

import type { Session } from "@expo/apple-utils";
// eslint-disable-next-line import-plugin/no-namespace -- the `appleUtils` injected dependency is typed as `typeof AppleUtils` (the whole module shape); no equivalent named type exists
import type * as AppleUtils from "@expo/apple-utils";

import { CliRuntime } from "../services/cli-runtime";
import { AppleAuthError } from "./exit-codes";
import { promptSelect } from "./prompts";

import type { InteractiveProhibitedError } from "./exit-codes";
import type { InteractiveMode } from "./interactive-mode";

type SessionProvider = Session.SessionProvider;

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
  appleUtils: typeof AppleUtils,
  providerId: number,
): Effect.Effect<void, AppleAuthError> =>
  Effect.tryPromise({
    try: async () => appleUtils.Session.setSessionProviderIdAsync(providerId),
    catch: (error) =>
      new AppleAuthError({
        message: `Failed to switch App Store Connect provider (${providerId}): ${String(error)}`,
      }),
  }).pipe(Effect.asVoid);

const isProviderAvailable = (providers: readonly SessionProvider[], providerId: number): boolean =>
  providers.some((provider) => provider.providerId === providerId);

/**
 * Resolve App Store Connect provider for an interactive session.
 *
 * Selection order: APPLE_PROVIDER_ID env → valid cached pick → single available
 * → preserve apple-utils' auto-resolved provider → prompt.
 *
 * `switched` flags that the apple-utils cookie jar was mutated; previously-captured
 * cookies are stale and callers should re-extract.
 *
 * Headless-safe: prompt only fires when no env, no valid cache, multiple providers,
 * AND apple-utils returned no auto-resolved provider.
 */
export const resolveProvider = (
  appleUtils: typeof AppleUtils,
  availableProviders: readonly SessionProvider[],
  currentProviderId: number | undefined,
  cachedProviderId: number | undefined,
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

    if (
      cachedProviderId !== undefined &&
      isProviderAvailable(availableProviders, cachedProviderId)
    ) {
      const id = yield* applyChoice(cachedProviderId);
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

    // Multi-provider, no explicit signal: respect apple-utils auto-resolution
    // (CI-safe). Only fall through to prompt when apple-utils returned nothing.
    if (currentProviderId !== undefined) {
      return { providerId: currentProviderId, switched };
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
