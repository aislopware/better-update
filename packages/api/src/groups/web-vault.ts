import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";

import { Forbidden } from "../auth/errors";
import { BadRequest } from "../domain/errors";
import { PasskeyStepUpBody, PasskeyStepUpResult } from "../domain/web-vault";

/**
 * Web-vault step-up: the WebAuthn re-authentication a browser session performs
 * before it may read/write env values (the "2FA mandatory before web env access"
 * rule, spec §P4). The browser fetches a challenge from better-auth's
 * `generate-authenticate-options`, runs the passkey ceremony, then POSTs the
 * assertion here; the server verifies it via the passkey plugin and records a
 * fresh step-up for THIS session. The env-vault write gate
 * (assert-web-env-step-up) consults that record. CLI/CI (bearer) callers never
 * need this — they are exempt from the gate.
 */
export class WebVaultGroup extends HttpApiGroup.make("webVault")
  .add(
    HttpApiEndpoint.post("stepUp", "/api/web-vault/step-up")
      .setPayload(PasskeyStepUpBody)
      .addSuccess(PasskeyStepUpResult)
      .annotateContext(
        OpenApi.annotations({
          title: "WebAuthn step-up",
          description:
            "Verify a fresh passkey assertion for the current browser session and record the step-up. Required before browser env-value reads/writes; cookie transport only.",
        }),
      ),
  )
  .addError(BadRequest)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Web Vault",
      description: "WebAuthn step-up for browser env-vault access",
    }),
  ) {}
