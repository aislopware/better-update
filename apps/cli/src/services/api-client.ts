import { ManagementApi } from "@better-update/api";
import { FetchHttpClient, HttpApiClient, HttpClient, HttpClientRequest } from "@effect/platform";
import { Effect } from "effect";

import { AuthStore } from "./auth-store";
import { ConfigStore } from "./config-store";

const client = HttpApiClient.make(ManagementApi);
export type ApiClient = Effect.Effect.Success<typeof client>;

export const apiClient = Effect.gen(function* () {
  const authStore = yield* AuthStore;
  const configStore = yield* ConfigStore;
  const token = yield* authStore.getToken;
  const baseUrl = yield* configStore.getBaseUrl;
  return yield* HttpApiClient.make(ManagementApi, {
    transformClient: HttpClient.mapRequest(HttpClientRequest.bearerToken(token)),
    baseUrl,
  });
}).pipe(Effect.provide(FetchHttpClient.layer));
