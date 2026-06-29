import { WEB_ENV_STEP_UP_REQUIRED_MESSAGE, WEB_ENV_STEP_UP_TTL_MS } from "@better-update/api";
import { Effect } from "effect";

import { Forbidden } from "../errors";
import { PasskeyStepUpRepo } from "../repositories/passkey-step-up";

import type { CurrentActor } from "../models";

// The TTL and the rejection message are shared with the browser (which mirrors the
// window to re-prompt proactively and to detect this specific rejection); re-exported
// here so existing server-internal imports keep their path.
export { WEB_ENV_STEP_UP_REQUIRED_MESSAGE, WEB_ENV_STEP_UP_TTL_MS };

/**
 * Gate browser (cookie-transport) env-value mutations behind a fresh WebAuthn
 * step-up — the "2FA mandatory before web env access" rule (spec §P4).
 *
 * CLI / CI callers (`transport: "bearer"`, incl. API keys) are EXEMPT: they hold
 * the vault key directly and authenticate with a credential that already proves
 * possession. The gate fires only for the browser, which unwraps the env vault
 * with a server-escrowed account key and so must re-prove identity with a
 * passkey before writing. Fails closed: no session id, no record, an unparseable
 * timestamp, or a stale one all deny.
 *
 * `nowMs` is injectable for deterministic tests; production passes the default.
 */
export const assertWebEnvStepUp = (
  actor: Pick<CurrentActor, "transport" | "sessionId">,
  options?: { readonly nowMs?: number; readonly ttlMs?: number },
): Effect.Effect<void, Forbidden, PasskeyStepUpRepo> =>
  Effect.gen(function* () {
    if (actor.transport !== "cookie") {
      return;
    }
    if (actor.sessionId === null) {
      return yield* new Forbidden({ message: WEB_ENV_STEP_UP_REQUIRED_MESSAGE });
    }

    const repo = yield* PasskeyStepUpRepo;
    const record = yield* repo.findBySession({ sessionId: actor.sessionId });
    if (record === null) {
      return yield* new Forbidden({ message: WEB_ENV_STEP_UP_REQUIRED_MESSAGE });
    }

    const verifiedAtMs = Date.parse(record.verifiedAt);
    const nowMs = options?.nowMs ?? Date.now();
    const ttlMs = options?.ttlMs ?? WEB_ENV_STEP_UP_TTL_MS;
    if (Number.isNaN(verifiedAtMs) || nowMs - verifiedAtMs > ttlMs) {
      return yield* new Forbidden({ message: WEB_ENV_STEP_UP_REQUIRED_MESSAGE });
    }
  });
