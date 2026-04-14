import { ManagementApi } from "@better-update/api";
import { HttpApiClient, HttpClient, HttpClientRequest } from "@effect/platform";
import { Context, Effect, Layer } from "effect";

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
  Effect.flatMap(ApiClientService, ({ get }) => get);

export const ApiClientLive = Layer.effect(
  ApiClientService,
  Effect.gen(function* () {
    const clientService = yield* HttpClient.HttpClient;
    const authStore = yield* AuthStore;
    const configStore = yield* ConfigStore;

    return {
      get: Effect.gen(function* () {
        const token = yield* authStore.getToken;
        const baseUrl = yield* configStore.getBaseUrl;
        return yield* HttpApiClient.make(ManagementApi, {
          transformClient: HttpClient.mapRequest(HttpClientRequest.bearerToken(token)),
          baseUrl,
        }).pipe(Effect.provideService(HttpClient.HttpClient, clientService));
      }),
    };
  }),
);
