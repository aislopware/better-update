import { Schema } from "effect";

/**
 * A WebAuthn authentication assertion, JSON-stringified by the browser
 * (`@better-auth/passkey/client` drives `navigator.credentials.get()`), carried
 * as a single string so the wire payload stays a plain object with no opaque
 * `unknown` fields. The step-up handler parses it and hands it to better-auth's
 * `verifyPasskeyAuthentication`; the exact inner shape is the plugin's contract,
 * not ours.
 */
export const PasskeyStepUpBody = Schema.Struct({
  assertionJson: Schema.String,
});

/**
 * Result of a successful step-up: the ISO instant the server recorded, which the
 * env-vault gate now treats as the start of the step-up TTL window for this
 * session.
 */
export const PasskeyStepUpResult = Schema.Struct({
  verifiedAt: Schema.String,
});

/**
 * How long a WebAuthn step-up authorizes browser env-vault reads/writes before a
 * fresh passkey assertion is required again. Short by design: the step-up is a
 * re-authentication for a sensitive action, not a login session. Shared so the
 * server gate and the browser (which mirrors the window to re-prompt proactively)
 * agree on the duration.
 */
export const WEB_ENV_STEP_UP_TTL_MS = 10 * 60 * 1000;

/**
 * The exact `Forbidden` message the server returns when a browser env-value
 * read/write is rejected for a missing or stale step-up. Shared so the browser can
 * detect this specific rejection (vs an unrelated permission `Forbidden`) and
 * re-prompt the passkey rather than dead-ending on the message.
 */
export const WEB_ENV_STEP_UP_REQUIRED_MESSAGE =
  "A passkey step-up is required before changing env values from the browser. Verify your passkey and retry.";
