import { ManagementApi } from "@better-update/api";
import { FetchHttpClient, HttpApiClient } from "@effect/platform";
import { Cause, Effect, Option, Runtime } from "effect";

const client = HttpApiClient.make(ManagementApi);

export type ApiClient = Effect.Effect.Success<typeof client>;

export const runApi = <A, E>(
  fn: (api: ApiClient) => Effect.Effect<A, E, never>,
  signal?: AbortSignal,
): Promise<A> =>
  Effect.runPromise(
    client.pipe(
      Effect.flatMap(fn),
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.RequestInit, {
        credentials: "include" as RequestCredentials,
      }),
      Effect.scoped,
    ),
    { signal },
  );

/**
 * Extracts a typed API error from an Effect FiberFailure.
 * Returns the error's `_tag` and `message` if the failure is a tagged error
 * (e.g., Conflict, NotFound, BadRequest), or null for non-Effect errors.
 */
export const getTypedApiError = (
  error: unknown,
): { readonly _tag: string; readonly message: string } | null => {
  if (!Runtime.isFiberFailure(error)) {
    return null;
  }
  const option = Cause.failureOption(error[Runtime.FiberFailureCauseId]);
  if (Option.isNone(option)) {
    return null;
  }
  const value = option.value;
  if (typeof value === "object" && value !== null && "_tag" in value && "message" in value) {
    return { _tag: String(value._tag), message: String(value.message) };
  }
  return null;
};

export const getApiError = (error: unknown): string => {
  const typed = getTypedApiError(error);
  if (typed) {
    return typed.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    // eslint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by `in` guard above
    return String((error as { message: unknown }).message);
  }
  return "An unexpected error occurred";
};
