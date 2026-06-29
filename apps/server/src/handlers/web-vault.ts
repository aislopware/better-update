import { isRecord } from "@better-update/type-guards";
import { HttpApiBuilder, HttpServerRequest } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { createAuth } from "../auth";
import { CurrentActor } from "../auth/current-actor";
import { toStandardHeaders } from "../auth/middleware";
import { cloudflareEnv } from "../cloudflare/context";
import { BadRequest, Forbidden } from "../errors";
import { toApiBadRequestForbiddenEffect } from "../http/to-api-effect";
import { PasskeyStepUpRepo } from "../repositories/passkey-step-up";

// Better Auth's `api` is inferred from the (conditionally-registered) plugin set;
// `verifyPasskeyAuthentication` is present only when WEBAUTHN_RP_ID is configured.
// We runtime-check for it rather than trust the inferred type — flag off ⇒ absent.
interface PasskeyAuthApi {
  readonly verifyPasskeyAuthentication: (opts: {
    body: unknown;
    headers: Headers;
  }) => Promise<unknown>;
}

const resolvePasskeyApi = (api: unknown): PasskeyAuthApi | null =>
  isRecord(api) && typeof api["verifyPasskeyAuthentication"] === "function"
    ? // eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- runtime shape validated above; narrows Better Auth's opaque plugin object
      (api as unknown as PasskeyAuthApi)
    : null;

export const WebVaultGroupLive = HttpApiBuilder.group(ManagementApi, "webVault", (handlers) =>
  handlers.handle("stepUp", ({ payload }) =>
    toApiBadRequestForbiddenEffect(
      Effect.gen(function* () {
        const ctx = yield* CurrentActor;
        // Step-up is a browser concept: it re-proves a cookie session. CLI/CI
        // (bearer / api-key) callers are exempt from the gate and never call this.
        if (ctx.transport !== "cookie" || ctx.sessionId === null || ctx.userId === null) {
          return yield* new BadRequest({
            message: "A passkey step-up applies only to an interactive browser session.",
          });
        }

        const parsed = yield* Effect.try({
          try: (): unknown => JSON.parse(payload.assertionJson),
          catch: () => new BadRequest({ message: "Malformed passkey assertion." }),
        });

        const env = yield* cloudflareEnv;
        const passkeyApi = resolvePasskeyApi(createAuth(env).api);
        if (passkeyApi === null) {
          return yield* new BadRequest({
            message: "WebAuthn is not enabled on this server.",
          });
        }

        const request = yield* HttpServerRequest.HttpServerRequest;
        const headers = toStandardHeaders(request.headers);

        // Delegate the assertion verification to the passkey plugin (it checks the
        // challenge it issued via generate-authenticate-options). A throw —
        // bad/replayed assertion — fails closed.
        const result = yield* Effect.tryPromise({
          try: async () => passkeyApi.verifyPasskeyAuthentication({ body: parsed, headers }),
          catch: () => new Forbidden({ message: "Passkey verification failed." }),
        });

        // verifyPasskeyAuthentication is a USERNAMELESS sign-in: it proves *some*
        // enrolled passkey signed the challenge, looked up globally by credential
        // id — it does NOT check the credential belongs to this cookie's user. A
        // step-up must prove the second factor AS THIS USER, else a stolen cookie
        // could be satisfied with the attacker's own passkey. So bind it: the
        // verified owner must equal the session user.
        const verifiedUser = isRecord(result) ? result["user"] : null;
        const verifiedUserId = isRecord(verifiedUser) ? verifiedUser["id"] : null;
        if (verifiedUserId !== ctx.userId) {
          return yield* new Forbidden({
            message: "That passkey does not belong to the signed-in user.",
          });
        }

        const verifiedAt = new Date().toISOString();
        const repo = yield* PasskeyStepUpRepo;
        yield* repo.record({ sessionId: ctx.sessionId, userId: ctx.userId, verifiedAt });

        yield* logAudit({
          action: "vault.web.step-up",
          resourceType: "vaultAccess",
          resourceId: ctx.sessionId,
        });

        return { verifiedAt };
      }),
    ),
  ),
);
