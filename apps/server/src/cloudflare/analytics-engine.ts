import { Context, Data, Effect, Layer } from "effect";

import { cloudflareEnv } from "./context";

export type AERow = Record<string, string>;

const EMPTY_ROWS: readonly AERow[] = [];

class AnalyticsEngineRequestError extends Data.TaggedError("AnalyticsEngineRequestError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

class AnalyticsEngineResponseParseError extends Data.TaggedError(
  "AnalyticsEngineResponseParseError",
)<{
  readonly message: string;
  readonly cause: unknown;
}> {}

const isAEResponse = (value: unknown): value is { data: readonly AERow[] } =>
  typeof value === "object" && value !== null && "data" in value && Array.isArray(value.data);

export interface AnalyticsEngineClient {
  readonly query: (sql: string) => Effect.Effect<readonly AERow[]>;
}

export class AnalyticsEngine extends Context.Tag("server/AnalyticsEngine")<
  AnalyticsEngine,
  AnalyticsEngineClient
>() {}

export const AnalyticsEngineLive = Layer.succeed(AnalyticsEngine, {
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
          new AnalyticsEngineRequestError({
            message: "Analytics Engine request failed",
            cause,
          }),
      });

      if (!response.ok) {
        yield* Effect.logWarning("Analytics Engine non-2xx response").pipe(
          Effect.annotateLogs({ status: response.status }),
        );
        return EMPTY_ROWS;
      }

      const json: unknown = yield* Effect.tryPromise({
        try: async () => response.json(),
        catch: (cause) =>
          new AnalyticsEngineResponseParseError({
            message: "Analytics Engine response was not valid JSON",
            cause,
          }),
      });
      return isAEResponse(json) ? json.data : EMPTY_ROWS;
    }).pipe(
      Effect.tapError((error) =>
        Effect.logWarning("Analytics Engine query failed").pipe(
          Effect.annotateLogs({ error: error.message }),
        ),
      ),
      Effect.orElseSucceed(() => EMPTY_ROWS),
    ),
});

export const queryAnalyticsEngine = (sql: string) =>
  Effect.gen(function* () {
    const client = yield* AnalyticsEngine;
    return yield* client.query(sql);
  });
