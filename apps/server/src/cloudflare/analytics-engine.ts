import { Context, Data, Effect, Layer } from "effect";

import { cloudflareEnv } from "./context";

export type AERow = Record<string, string>;

/**
 * A query that never reached Analytics Engine, or that AE refused.
 *
 * STRICTLY distinct from "the dataset returned no rows". A deployment whose
 * `CLOUDFLARE_API_TOKEN` secret is unset — or whose token lacks *Account
 * Analytics Read* — fails EVERY analytics query, and collapsing that into an
 * empty row set made a broken read path indistinguishable from a project no
 * device has ever checked into: both drew "No analytics yet". The failure is
 * still never allowed to fail a dashboard request (the repository turns it into
 * an `unavailable` result), but it now says which of the two happened.
 */
export class AnalyticsUnavailable extends Data.TaggedError("AnalyticsUnavailable")<{
  readonly reason: string;
  readonly cause: unknown;
}> {}

const isAEResponse = (value: unknown): value is { data: readonly AERow[] } =>
  typeof value === "object" && value !== null && "data" in value && Array.isArray(value.data);

/**
 * The dataset names to query, as configured for this deployment. The bindings
 * name the datasets for WRITES; the SQL API takes the dataset as a table name,
 * so reads need the names as values — an instance that renamed a dataset would
 * otherwise write to one table and query another.
 */
export interface AnalyticsDatasets {
  /** Manifest checks. `ANALYTICS` binding / `BU_ANALYTICS_DATASET`. */
  readonly updates: string;
  /** Bundle downloads. `DELIVERY_ANALYTICS` / `BU_DELIVERY_ANALYTICS_DATASET`. */
  readonly deliveries: string;
}

const DATASET_NAME_RE = /^[A-Za-z0-9_]{1,64}$/u;

// Dataset names are operator config, not user input — but they are interpolated
// into SQL as a table name, so a malformed value falls back to the built-in
// default rather than reaching the SQL API.
const sanitizeDataset = (value: string, fallback: string): string =>
  DATASET_NAME_RE.test(value) ? value : fallback;

export interface AnalyticsEngineClient {
  readonly datasets: Effect.Effect<AnalyticsDatasets>;
  readonly query: (sql: string) => Effect.Effect<readonly AERow[], AnalyticsUnavailable>;
}

export class AnalyticsEngine extends Context.Tag("server/AnalyticsEngine")<
  AnalyticsEngine,
  AnalyticsEngineClient
>() {}

export const AnalyticsEngineLive = Layer.succeed(AnalyticsEngine, {
  datasets: Effect.gen(function* () {
    const env = yield* cloudflareEnv;
    return {
      updates: sanitizeDataset(env.ANALYTICS_DATASET, "update_events"),
      deliveries: sanitizeDataset(env.DELIVERY_ANALYTICS_DATASET, "delivery_events"),
    };
  }),

  query: (sql) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const response = yield* Effect.tryPromise({
        try: async () =>
          fetch(
            `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/analytics_engine/sql`,
            {
              method: "POST",
              headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
              body: sql,
            },
          ),
        catch: (cause) =>
          new AnalyticsUnavailable({ reason: "Analytics Engine request failed", cause }),
      });

      if (!response.ok) {
        // 401/403 here is the common self-hosting misconfiguration: the secret
        // is missing, or the token has no *Account Analytics Read* permission.
        // The status rides the reason so the Worker log names the cause.
        return yield* new AnalyticsUnavailable({
          reason: `Analytics Engine returned HTTP ${response.status}`,
          cause: undefined,
        });
      }

      const json: unknown = yield* Effect.tryPromise({
        try: async () => response.json(),
        catch: (cause) =>
          new AnalyticsUnavailable({
            reason: "Analytics Engine response was not valid JSON",
            cause,
          }),
      });
      // A 200 without a `data` array means AE rejected the SQL itself.
      if (!isAEResponse(json)) {
        return yield* new AnalyticsUnavailable({
          reason: "Analytics Engine response carried no data array",
          cause: undefined,
        });
      }
      return json.data;
    }).pipe(
      Effect.tapError((error) =>
        Effect.logWarning("Analytics Engine query failed").pipe(
          Effect.annotateLogs({ reason: error.reason }),
        ),
      ),
    ),
});

export const queryAnalyticsEngine = (sql: string) =>
  Effect.gen(function* () {
    const client = yield* AnalyticsEngine;
    return yield* client.query(sql);
  });
