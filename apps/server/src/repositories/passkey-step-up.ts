import { Context, Effect, Layer } from "effect";

import { kyselyDb } from "../cloudflare/db";

// -- Port -------------------------------------------------------------------

/**
 * Records that a specific browser session re-asserted a passkey (WebAuthn
 * step-up). Keyed by the better-auth `session.id` so a step-up authorizes only
 * the session that proved it. Written by the web-vault step-up handler after a
 * verified assertion; read by {@link ../application/assert-web-env-step-up} to
 * gate cookie-transport env mutations. CLI (bearer / api-key) callers never hit
 * this table — they are exempt by transport.
 */
export interface PasskeyStepUpRepository {
  /** Upsert the step-up timestamp for a session (one row per session). */
  readonly record: (params: {
    readonly sessionId: string;
    readonly userId: string;
    readonly verifiedAt: string;
  }) => Effect.Effect<void>;

  /** The step-up record for a session, or `null` if it never stepped up. */
  readonly findBySession: (params: {
    readonly sessionId: string;
  }) => Effect.Effect<{ readonly verifiedAt: string } | null>;
}

export class PasskeyStepUpRepo extends Context.Tag("api/PasskeyStepUpRepo")<
  PasskeyStepUpRepo,
  PasskeyStepUpRepository
>() {}

// -- D1 Adapter -------------------------------------------------------------

export const PasskeyStepUpRepoLive = Layer.succeed(PasskeyStepUpRepo, {
  record: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .insertInto("passkey_step_up")
          .values({
            session_id: params.sessionId,
            user_id: params.userId,
            verified_at: params.verifiedAt,
          })
          .onConflict((oc) =>
            oc
              .column("session_id")
              .doUpdateSet({ user_id: params.userId, verified_at: params.verifiedAt }),
          )
          .execute(),
      );
    }),

  findBySession: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("passkey_step_up")
          .select("verified_at")
          .where("session_id", "=", params.sessionId)
          .executeTakeFirst(),
      );
      return row === undefined ? null : { verifiedAt: row.verified_at };
    }),
});
