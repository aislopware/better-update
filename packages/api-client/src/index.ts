import { ManagementApi } from "@better-update/api";
import { Effect, Ref } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";

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

export type ApiClient = Effect.Success<typeof getClient>;

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
    // in TanStack Router/Query and blanks the page. Effect v4 rejects with the
    // squashed cause — the tagged API error itself, which extends Error — so
    // typed failures pass through untouched for getTypedApiError.
    .catch((error: unknown) => {
      // eslint-disable-next-line functional/no-throw-statements -- rejection is TanStack Query's error channel; coerce non-Error rejects so CatchBoundary's truthy check renders
      throw error instanceof Error
        ? error
        : new Error("API request failed with a non-Error value", { cause: error });
    });

/**
 * Extracts a typed API error from a `runApi` rejection. Effect v4 rejects with
 * the squashed cause — the tagged error value itself — so the rejection IS the
 * `Conflict` / `NotFound` / `BadRequest` instance; no FiberFailure unwrapping.
 * Returns its `_tag` and `message`, or null for anything untagged.
 *
 * `UnknownError` is intentionally skipped: it's the wrapper Effect uses when a
 * `tryPromise` lacks a `catch` mapper, and its `message` is generic. The real
 * error lives in `cause` and is handled by `getApiError`.
 */
export const getTypedApiError = (
  error: unknown,
): { readonly _tag: string; readonly message: string } | null => {
  if (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    "message" in error &&
    error._tag !== "UnknownError"
  ) {
    return { _tag: String(error._tag), message: String(error.message) };
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
  // `Cause.UnknownError` wrapper (an unmapped tryPromise rejection) — dig into
  // its cause for the real error message.
  const fromCause =
    typeof error === "object" && error !== null && "cause" in error
      ? extractMessage(error.cause)
      : null;
  if (fromCause !== null) {
    return fromCause;
  }
  const fromError = extractMessage(error);
  if (fromError !== null) {
    return fromError;
  }
  return "An unexpected error occurred";
};
