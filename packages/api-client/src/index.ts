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
        credentials: "include",
      }),
      Effect.scoped,
    ),
    signal ? { signal } : undefined,
  )
    // Rejections must always be real Errors: a falsy reject (e.g. an aborted
    // fetch racing a route transition) slips past truthy `if (error)` checks
    // in TanStack Router/Query and blanks the page. FiberFailure is an Error,
    // so typed API failures pass through untouched for getTypedApiError.
    // eslint-disable-next-line promise/prefer-await-to-then -- runApi is the Promise boundary for TanStack Query; .catch keeps the expression form
    .catch((error: unknown) => {
      // eslint-disable-next-line functional/no-throw-statements -- rejection is TanStack Query's error channel; coerce non-Error rejects so CatchBoundary's truthy check renders
      throw error instanceof Error
        ? error
        : new Error("API request failed with a non-Error value", { cause: error });
    });

/**
 * Extracts a typed API error from an Effect FiberFailure.
 * Returns the error's `_tag` and `message` if the failure is a tagged error
 * (e.g., Conflict, NotFound, BadRequest), or null for non-Effect errors.
 *
 * `UnknownException` is intentionally skipped: it's the wrapper Effect uses
 * when a `tryPromise` lacks a `catch` mapper, and its `message` is the
 * generic "An unknown error occurred in Effect.tryPromise". The real error
 * lives in `cause` and is handled by `getApiError`.
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
  if (
    typeof value === "object" &&
    value !== null &&
    "_tag" in value &&
    "message" in value &&
    value._tag !== "UnknownException"
  ) {
    return { _tag: String(value._tag), message: String(value.message) };
  }
  return null;
};

const extractMessage = (value: unknown): string | null => {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "object" && value !== null && "message" in value) {
    const { message } = value;
    return typeof message === "string" ? message : null;
  }
  return null;
};

export const getApiError = (error: unknown): string => {
  const typed = getTypedApiError(error);
  if (typed) {
    return typed.message;
  }
  // FiberFailure with an UnknownException wrapper (e.g. unmapped tryPromise
  // rejection) — dig into the cause for the real error message.
  if (Runtime.isFiberFailure(error)) {
    const option = Cause.failureOption(error[Runtime.FiberFailureCauseId]);
    if (Option.isSome(option)) {
      const { value } = option;
      const fromCause =
        typeof value === "object" && value !== null && "cause" in value
          ? extractMessage(value.cause)
          : null;
      if (fromCause !== null) {
        return fromCause;
      }
      const direct = extractMessage(value);
      if (direct !== null) {
        return direct;
      }
    }
  }
  const fromError = extractMessage(error);
  if (fromError !== null) {
    return fromError;
  }
  return "An unexpected error occurred";
};
