import { ManagementApi } from "@better-update/api";
import { HttpApiClient, HttpClient, HttpClientRequest } from "@effect/platform";
import { Context, Effect, Layer, Schedule } from "effect";

import { AuthStore } from "./auth-store";
import { ConfigStore } from "./config-store";

import type { AuthRequiredError } from "../lib/exit-codes";

const client = HttpApiClient.make(ManagementApi);
export type ApiClient = Effect.Effect.Success<typeof client>;

export class ApiClientService extends Context.Tag("cli/ApiClient")<
  ApiClientService,
  {
    readonly get: Effect.Effect<ApiClient, AuthRequiredError>;
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
    };
  }),
);
