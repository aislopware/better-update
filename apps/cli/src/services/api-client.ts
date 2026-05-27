import { ManagementApi } from "@better-update/api";
import { Headers, HttpApiClient, HttpClient, HttpClientRequest } from "@effect/platform";
import { Context, Effect, Layer, Option, Schedule } from "effect";

import { LoginError } from "../lib/exit-codes";
import { AuthStore } from "./auth-store";
import { ConfigStore } from "./config-store";

import type { AuthRequiredError } from "../lib/exit-codes";

const client = HttpApiClient.make(ManagementApi);
export type ApiClient = Effect.Effect.Success<typeof client>;

export class ApiClientService extends Context.Tag("cli/ApiClient")<
  ApiClientService,
  {
    readonly get: Effect.Effect<ApiClient, AuthRequiredError>;
    readonly exchangeOneTimeToken: (oneTimeToken: string) => Effect.Effect<string, LoginError>;
  }
>() {}

export const apiClient: Effect.Effect<ApiClient, AuthRequiredError, ApiClientService> =
  // eslint-disable-next-line unicorn/no-array-method-this-argument -- Effect.flatMap, not Array.prototype.flatMap; the second arg is a continuation, not a thisArg
  Effect.flatMap(ApiClientService, ({ get }) => get);

// Retry transient client-side failures (DNS hiccup, broken connection, TLS
// handshake reset, fetch timeout) so a flaky network doesn't sink a multi-
// minute build after staging + pod install. Scoped to `errors-only` so 5xx
// response statuses are NOT retried — POST handlers may have side-effected
// before the response failed.
const RETRY_TRANSIENT_OPTIONS = {
  mode: "errors-only",
  times: 4,
  schedule: Schedule.exponential("500 millis", 2),
} as const;

export const ApiClientLive = Layer.effect(
  ApiClientService,
  Effect.gen(function* () {
    const clientService = yield* HttpClient.HttpClient;
    const authStore = yield* AuthStore;
    const configStore = yield* ConfigStore;
    const retryingClient = HttpClient.retryTransient(clientService, RETRY_TRANSIENT_OPTIONS);

    return {
      get: Effect.gen(function* () {
        const token = yield* authStore.getToken;
        const baseUrl = yield* configStore.getBaseUrl;
        return yield* HttpApiClient.make(ManagementApi, {
          transformClient: HttpClient.mapRequest(HttpClientRequest.bearerToken(token)),
          baseUrl,
        }).pipe(Effect.provideService(HttpClient.HttpClient, retryingClient));
      }),

      // The browser hands the CLI a Better Auth one-time token; exchange it at
      // the verify endpoint for a real session token, surfaced via the
      // `set-auth-token` response header by the `bearer` plugin. That token is
      // what every later request sends as `Authorization: Bearer`.
      exchangeOneTimeToken: (oneTimeToken: string) =>
        Effect.gen(function* () {
          const baseUrl = yield* configStore.getBaseUrl;
          const request = yield* HttpClientRequest.post(
            `${baseUrl}/api/auth/one-time-token/verify`,
          ).pipe(
            HttpClientRequest.bodyJson({ token: oneTimeToken }),
            Effect.mapError(
              () => new LoginError({ message: "Could not encode the login request." }),
            ),
          );
          const response = yield* retryingClient
            .execute(request)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new LoginError({ message: `Could not reach the login server: ${String(cause)}` }),
              ),
            );
          if (response.status < 200 || response.status >= 300) {
            return yield* new LoginError({
              message: `Login token exchange failed (HTTP ${response.status}). Run \`better-update login\` again.`,
            });
          }
          const sessionToken = Headers.get(response.headers, "set-auth-token");
          if (Option.isNone(sessionToken)) {
            return yield* new LoginError({
              message:
                "The login server did not return a session token (missing set-auth-token header).",
            });
          }
          return sessionToken.value;
        }),
    };
  }),
);
