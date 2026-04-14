import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "./context";

export type AERow = Record<string, string>;

const EMPTY_ROWS: readonly AERow[] = [];

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
      const response = yield* Effect.tryPromise(async () =>
        fetch(
          `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/analytics_engine/sql`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` },
            body: sql,
          },
        ),
      );

      if (!response.ok) {
        return EMPTY_ROWS;
      }

      const json: unknown = yield* Effect.tryPromise(async () => response.json());
      return isAEResponse(json) ? json.data : EMPTY_ROWS;
    }).pipe(Effect.orElseSucceed(() => EMPTY_ROWS)),
});

export const queryAnalyticsEngine = (sql: string) =>
  Effect.gen(function* () {
    const client = yield* AnalyticsEngine;
    return yield* client.query(sql);
  });
