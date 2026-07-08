import { ManagementApi } from "@better-update/api";
import { Headers, HttpApiClient, HttpClient, HttpClientRequest } from "@effect/platform";
import { Context, Effect, Layer, Option, Schedule, Schema } from "effect";

import { AuthRequiredError, LoginError, OrgError } from "../lib/exit-codes";
import { AuthStore } from "./auth-store";
import { ConfigStore } from "./config-store";

const client = HttpApiClient.make(ManagementApi);
export type ApiClient = Effect.Effect.Success<typeof client>;

// Better Auth's organization endpoints live on the auth routes (`/api/auth/*`),
// outside the typed ManagementApi — the CLI calls them raw, authenticated with
// the same bearer session token the typed client sends. Only the fields the CLI
// renders are decoded; extra fields are ignored.
const AuthOrganizationSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
});
const AuthOrganizationList = Schema.Array(AuthOrganizationSchema);

/** An organization the authenticated user belongs to (from `organization/list`). */
export type AuthOrganization = typeof AuthOrganizationSchema.Type;

export class ApiClientService extends Context.Tag("cli/ApiClient")<
  ApiClientService,
  {
    readonly get: Effect.Effect<ApiClient, AuthRequiredError>;
    readonly exchangeOneTimeToken: (oneTimeToken: string) => Effect.Effect<string, LoginError>;
    /** The organizations the authenticated user is a member of. */
    readonly listOrganizations: Effect.Effect<
      readonly AuthOrganization[],
      AuthRequiredError | OrgError
    >;
    /**
     * Point this CLI session at another organization (better-auth
     * `organization/set-active`). Every later request scopes to it.
     */
    readonly setActiveOrganization: (
      organizationId: string,
    ) => Effect.Effect<void, AuthRequiredError | OrgError>;
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

// A 401 from an auth route means the stored session token no longer works —
// surface it as AuthRequiredError so the runEffect boundary offers a re-login.
const SESSION_EXPIRED = "Your session is no longer valid. Run `better-update login`.";

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

      listOrganizations: Effect.gen(function* () {
        const token = yield* authStore.getToken;
        const baseUrl = yield* configStore.getBaseUrl;
        const request = HttpClientRequest.get(`${baseUrl}/api/auth/organization/list`).pipe(
          HttpClientRequest.bearerToken(token),
        );
        const response = yield* retryingClient
          .execute(request)
          .pipe(
            Effect.mapError(
              (cause) => new OrgError({ message: `Could not reach the server: ${String(cause)}` }),
            ),
          );
        if (response.status === 401) {
          return yield* new AuthRequiredError({ message: SESSION_EXPIRED });
        }
        if (response.status < 200 || response.status >= 300) {
          return yield* new OrgError({
            message: `Listing organizations failed (HTTP ${response.status}).`,
          });
        }
        const body = yield* response.json.pipe(
          Effect.mapError(
            () => new OrgError({ message: "The organization list response was not valid JSON." }),
          ),
        );
        return yield* Schema.decodeUnknown(AuthOrganizationList)(body).pipe(
          Effect.mapError(
            () => new OrgError({ message: "Unexpected organization list response shape." }),
          ),
        );
      }),

      setActiveOrganization: (organizationId: string) =>
        Effect.gen(function* () {
          const token = yield* authStore.getToken;
          const baseUrl = yield* configStore.getBaseUrl;
          const request = yield* HttpClientRequest.post(
            `${baseUrl}/api/auth/organization/set-active`,
          ).pipe(
            HttpClientRequest.bearerToken(token),
            HttpClientRequest.bodyJson({ organizationId }),
            Effect.mapError(
              () => new OrgError({ message: "Could not encode the switch request." }),
            ),
          );
          const response = yield* retryingClient
            .execute(request)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new OrgError({ message: `Could not reach the server: ${String(cause)}` }),
              ),
            );
          if (response.status === 401) {
            return yield* new AuthRequiredError({ message: SESSION_EXPIRED });
          }
          if (response.status < 200 || response.status >= 300) {
            return yield* new OrgError({
              message: `Switching the active organization failed (HTTP ${response.status}).`,
            });
          }
        }),
    };
  }),
);
