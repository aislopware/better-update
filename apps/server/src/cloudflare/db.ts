import { toOptional } from "@better-update/type-guards";
import { Effect } from "effect";
import { Kysely } from "kysely";

import type { Compilable, InferResult } from "kysely";

import { d1Session } from "./context";
import { makeD1Dialect } from "./d1-dialect";

import type { DB } from "../db/schema";

/**
 * One `Kysely` instance per D1 session. The session already encapsulates the
 * per-request bookmark, so caching by session (not globally) keeps every query
 * in a request on the same read-replication anchor while never leaking a
 * builder across requests. The map is weak: instances die with their session.
 */
const kyselyBySession = new WeakMap<D1DatabaseSession, Kysely<DB>>();

const kyselyForSession = (session: D1DatabaseSession): Kysely<DB> => {
  const cached = kyselyBySession.get(session);
  if (cached) {
    return cached;
  }
  const db = new Kysely<DB>({ dialect: makeD1Dialect({ database: session }) });
  kyselyBySession.set(session, db);
  return db;
};

/**
 * The typed query builder for the current request, bound to its D1 session.
 *
 * ```ts
 * const db = yield* kyselyDb;
 * const row = yield* Effect.promise(() =>
 *   db.selectFrom("organization").selectAll().where("id", "=", id).executeTakeFirst(),
 * );
 * ```
 */
export const kyselyDb: Effect.Effect<Kysely<DB>> = d1Session.pipe(Effect.map(kyselyForSession));

/**
 * Run several compiled Kysely queries as a single atomic `D1.batch` — D1's only
 * form of multi-statement atomicity (it has no interactive transactions). If
 * any statement fails the whole batch rolls back. Returns each query's rows in
 * order, typed from the builders.
 *
 * ```ts
 * const db = yield* kyselyDb;
 * yield* d1Batch([
 *   db.deleteFrom("updates").where("branch_id", "=", id),
 *   db.deleteFrom("branches").where("id", "=", id),
 * ]);
 * ```
 */
export const d1Batch = <const Queries extends readonly Compilable[]>(
  queries: Queries,
): Effect.Effect<{ readonly [K in keyof Queries]: InferResult<Queries[K]> }> =>
  d1Session.pipe(
    Effect.flatMap((session) =>
      Effect.promise(async () => {
        const statements = queries.map((query) => {
          const { sql, parameters } = query.compile();
          return session.prepare(sql).bind(...parameters);
        });
        const results = await session.batch(statements);
        // eslint-disable-next-line typescript/no-unsafe-type-assertion -- D1.batch returns results positionally aligned with the input queries; the mapped-tuple type cannot be reconstructed structurally
        return results.map((result) => result.results) as {
          readonly [K in keyof Queries]: InferResult<Queries[K]>;
        };
      }),
    ),
  );

/**
 * HTTP header used to carry the D1 session bookmark between requests. A client
 * that echoes the value it last received gets read-your-writes across requests;
 * clients that ignore it still get fast, eventually-consistent replica reads.
 */
export const D1_BOOKMARK_HEADER = "x-d1-bookmark";

/** The inbound bookmark a client sent, if any, to anchor this request's session. */
export const readD1Bookmark = (request: Request): D1SessionBookmark | undefined =>
  toOptional(request.headers.get(D1_BOOKMARK_HEADER));

/**
 * Stamp the session's latest bookmark onto the response so the client can send
 * it back on its next request. No-op until the session has run a query
 * (`getBookmark()` is `null`). Returns a fresh `Response` because a Worker
 * `Response`'s headers can be immutable once constructed.
 */
export const applyD1Bookmark = (response: Response, session: D1DatabaseSession): Response => {
  const bookmark = session.getBookmark();
  if (!bookmark) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set(D1_BOOKMARK_HEADER, bookmark);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
