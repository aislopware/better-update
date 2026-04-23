import { ManagementApi } from "@better-update/api";
import { FetchHttpClient, HttpApiClient } from "@effect/platform";
import { Cause, Effect, Option, Ref, Runtime } from "effect";

const baseUrlRef = Effect.runSync(Ref.make<string>(""));

/**
 * Configures the absolute base URL used when issuing typed API requests.
 * Called once at app startup, before any query fires, with the host SPA's
 * `VITE_API_URL` (apps/web calls into this package).
 *
 * Defaults to an empty string, which resolves fetch calls against the
 * current page origin — useful for Vite dev proxying `/api/*` to the
 * server worker.
 */
export const configureApiBaseUrl = (baseUrl: string): void => {
  Effect.runSync(Ref.set(baseUrlRef, baseUrl));
};

const getClient = Effect.flatMap(Ref.get(baseUrlRef), (baseUrl) =>
  HttpApiClient.make(ManagementApi, { baseUrl }),
);

export type ApiClient = Effect.Effect.Success<typeof getClient>;

export const runApi = async <Success, Failure>(
  fn: (api: ApiClient) => Effect.Effect<Success, Failure>,
  signal?: AbortSignal,
): Promise<Success> =>
  Effect.runPromise(
    getClient.pipe(
      Effect.flatMap(fn),
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.RequestInit, {
        credentials: "include" as RequestCredentials,
      }),
      Effect.scoped,
    ),
    signal ? { signal } : undefined,
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
  const { value } = option;
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
    return String((error as { message: unknown }).message);
  }
  return "An unexpected error occurred";
};
