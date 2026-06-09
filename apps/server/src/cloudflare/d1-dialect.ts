import { SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler } from "kysely";

import type {
  CompiledQuery,
  DatabaseConnection,
  Dialect,
  Driver,
  Kysely,
  QueryResult,
} from "kysely";

/**
 * The slice of the D1 binding our driver needs to run a query. Both
 * `D1Database` and `D1DatabaseSession` structurally satisfy it, so the very
 * same dialect drives a plain connection or a read-replication session
 * (`env.DB.withSession(...)`) without any branching.
 */
export type D1Queryable = Pick<D1Database, "prepare" | "batch">;

export interface D1DialectConfig {
  readonly database: D1Queryable;
}

/**
 * A first-party Kysely dialect for Cloudflare D1.
 *
 * D1 speaks SQLite, so we reuse Kysely's built-in SQLite adapter, compiler and
 * introspector and only supply the driver that talks to the Workers binding.
 *
 * Why not `kysely-d1`: that community package pins `kysely: "*"`, ships a
 * `@ts-ignore` for a long-deprecated result field, and cannot accept a
 * `D1DatabaseSession`. This version is pinned to our Kysely, carries no
 * deprecated surface, and is session-aware for global read replication.
 *
 * D1 has no interactive transactions — `db.transaction()` therefore rejects.
 * Use {@link ../cloudflare/db.d1Batch} (one atomic `D1.batch`) for
 * multi-statement atomicity instead.
 */
export const makeD1Dialect = (config: D1DialectConfig): Dialect => ({
  createAdapter: () => new SqliteAdapter(),
  createDriver: () => makeD1Driver(config),
  createQueryCompiler: () => new SqliteQueryCompiler(),
  createIntrospector: (db: Kysely<unknown>) => new SqliteIntrospector(db),
});

const unsupported = (feature: string): never => {
  // eslint-disable-next-line functional/no-throw-statements -- Kysely Driver/DatabaseConnection contract: signal a capability D1 does not provide
  throw new Error(`Cloudflare D1 does not support ${feature}.`);
};

/* eslint-disable typescript/promise-function-async -- Kysely Driver contract types these hooks as `() => Promise<void>`, but D1 has no pool/handshake to await; making them `async` would only trade this for require-await. */
const makeD1Driver = (config: D1DialectConfig): Driver => ({
  init: () => Promise.resolve(),
  acquireConnection: () => Promise.resolve(makeD1Connection(config)),
  beginTransaction: () => unsupported("interactive transactions (use d1Batch for atomic writes)"),
  commitTransaction: () => unsupported("interactive transactions"),
  rollbackTransaction: () => unsupported("interactive transactions"),
  releaseConnection: () => Promise.resolve(),
  destroy: () => Promise.resolve(),
});
/* eslint-enable typescript/promise-function-async */

const makeD1Connection = (config: D1DialectConfig): DatabaseConnection => ({
  executeQuery: async <R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> => {
    const result = await config.database
      .prepare(compiledQuery.sql)
      .bind(...compiledQuery.parameters)
      .all<R>();

    const { changes, last_row_id } = result.meta;
    return {
      rows: result.results,
      // D1 always returns a numeric last_row_id; Kysely only reads it for
      // auto-increment inserts (our tables use TEXT ids, so it is inert).
      insertId: BigInt(last_row_id),
      // Omit the key entirely when unchanged — exactOptionalPropertyTypes
      // forbids an explicit `undefined`.
      ...(changes > 0 ? { numAffectedRows: BigInt(changes) } : {}),
    };
  },
  // D1 has no cursor protocol; surfacing it as unsupported keeps `.stream()`
  // from silently buffering the whole table.
  streamQuery: () => unsupported("streaming queries"),
});
