import { ManagementApi } from "@better-update/api";
import { FetchHttpClient, HttpApiClient } from "@effect/platform";
import { Effect } from "effect";

const client = HttpApiClient.make(ManagementApi);

export type ApiClient = Effect.Effect.Success<typeof client>;

export const runApi = <A, E>(fn: (api: ApiClient) => Effect.Effect<A, E, never>): Promise<A> =>
  Effect.runPromise(
    client.pipe(
      Effect.flatMap(fn),
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.RequestInit, {
        credentials: "include" as RequestCredentials,
      }),
      Effect.scoped,
    ),
  );

export const getApiError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "An unexpected error occurred";
};
